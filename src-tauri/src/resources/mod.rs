pub mod catalog;
pub mod install;
pub mod probe;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    local: HashMap<String, PathBuf>,
    mirror: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceStatus {
    #[serde(flatten)]
    pub resource: catalog::Resource,
    pub status: String,
    pub source: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    pub managed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProgress {
    pub id: String,
    pub phase: String,
    pub received: u64,
    pub total: u64,
}

static CONFIG_LOCK: Mutex<()> = Mutex::new(());
static OPERATIONS: OnceLock<Mutex<HashMap<String, (usize, Option<Arc<AtomicBool>>)>>> =
    OnceLock::new();
fn operations() -> &'static Mutex<HashMap<String, (usize, Option<Arc<AtomicBool>>)>> {
    OPERATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct ResourceLease {
    id: String,
}
impl Drop for ResourceLease {
    fn drop(&mut self) {
        if let Ok(mut map) = operations().lock() {
            if let Some(value) = map.get_mut(&self.id) {
                value.0 = value.0.saturating_sub(1);
            }
        }
    }
}
pub fn lease(id: &str) -> Result<ResourceLease, String> {
    let mut map = operations().lock().map_err(|e| e.to_string())?;
    let state = map.entry(id.into()).or_default();
    if state.1.is_some() {
        return Err(format!("Resource {id} is being changed; please retry"));
    }
    state.0 += 1;
    Ok(ResourceLease { id: id.into() })
}
struct Operation {
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Operation {
    fn begin(id: &str) -> Result<Self, String> {
        let mut map = operations().lock().map_err(|e| e.to_string())?;
        let state = map.entry(id.into()).or_default();
        if state.0 != 0 || state.1.is_some() {
            return Err("Resource is in use or another operation is running".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        state.1 = Some(cancel.clone());
        let operation = Self {
            id: id.into(),
            cancel,
        };
        drop(map);
        if matches!(id, "java" | "plantuml") {
            crate::plantuml::stop_idle_workers()?;
        }
        Ok(operation)
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut map) = operations().lock() {
            if let Some(state) = map.get_mut(&self.id) {
                state.1 = None;
            }
        }
    }
}

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("resources-v1"))
        .map_err(|e| e.to_string())
}
fn config(app: &tauri::AppHandle) -> Result<Config, String> {
    let _lock = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    read_config(app)
}
fn read_config(app: &tauri::AppHandle) -> Result<Config, String> {
    let path = root(app)?.join("config.json");
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn update_config(app: &tauri::AppHandle, update: impl FnOnce(&mut Config)) -> Result<(), String> {
    let _lock = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let mut value = read_config(app)?;
    update(&mut value);
    let directory = root(app)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    install::reject_links(&directory)?;
    let target = directory.join("config.json");
    let temporary = directory.join(format!(".config-{}", nanoid::nanoid!()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let previous = directory.join("config.previous.json");
    if target.exists() {
        fs::rename(&target, &previous).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        if previous.exists() {
            let _ = fs::rename(&previous, &target);
        }
        let _ = fs::remove_file(temporary);
        return Err(error.to_string());
    }
    let _ = fs::remove_file(previous);
    Ok(())
}
fn managed_dir(app: &tauri::AppHandle, resource: &catalog::Resource) -> Result<PathBuf, String> {
    Ok(root(app)?.join(&resource.id).join(&resource.version))
}

fn legacy_candidates(app: &tauri::AppHandle, resource: &catalog::Resource) -> Vec<PathBuf> {
    let relative = match resource.id.as_str() {
        "chromium" => "chromium/win-x64/chrome-headless-shell.exe",
        "ffmpeg" => "ffmpeg.exe",
        "java" => "plantuml/jre/bin/java.exe",
        "plantuml" => "plantuml/plantuml.jar",
        _ => return Vec::new(),
    };
    let mut roots = Vec::new();
    if let Ok(base) = app.path().resource_dir() {
        roots.push(base.clone());
        roots.push(base.join("resources"));
    }
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    roots
        .into_iter()
        .map(|base| base.join(relative))
        .filter(|p| p.is_file())
        .collect()
}

fn check_candidate(id: &str, path: &Path) -> Result<(), String> {
    static CACHE: OnceLock<
        Mutex<HashMap<(String, PathBuf, u64, Option<std::time::SystemTime>), ()>>,
    > = OnceLock::new();
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let key = (
        id.to_string(),
        path.to_path_buf(),
        metadata.len(),
        metadata.modified().ok(),
    );
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if cache.lock().map_err(|e| e.to_string())?.contains_key(&key) {
        return Ok(());
    }
    probe::validate(id, path)?;
    cache.lock().map_err(|e| e.to_string())?.insert(key, ());
    Ok(())
}

pub fn resolve(app: &tauri::AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    let resource = catalog::resource(id)?;
    catalog::check_platform(resource)?;
    let settings = config(app)?;
    let mut candidates = Vec::new();
    if let Some(path) = settings.local.get(id) {
        candidates.push((path.clone(), "local"));
    }
    let managed = managed_dir(app, resource)?.join(&resource.entry);
    candidates.push((managed, "managed"));
    candidates.extend(
        legacy_candidates(app, resource)
            .into_iter()
            .map(|p| (p, "bundled")),
    );
    candidates.extend(
        probe::system_candidates(id)
            .into_iter()
            .map(|p| (p, "system")),
    );
    let mut errors = Vec::new();
    for (path, source) in candidates {
        if !path.is_file() {
            continue;
        }
        let checked = if source == "managed" {
            install::verify_directory(&managed_dir(app, resource)?, resource)
                .and_then(|_| check_candidate(id, &path))
        } else {
            check_candidate(id, &path)
        };
        match checked {
            Ok(()) => return Ok((path, source.into())),
            Err(error) => errors.push(error),
        }
    }
    Err(format!(
        "RESOURCE_REQUIRED:{id}: {}",
        if errors.is_empty() {
            "Open Settings → Resources to download or select a local resource".into()
        } else {
            errors.join("; ")
        }
    ))
}

fn statuses(app: &tauri::AppHandle) -> Vec<ResourceStatus> {
    catalog::catalog()
        .resources
        .iter()
        .map(|resource| {
            let managed = managed_dir(app, resource)
                .map(|p| p.join(&resource.entry).is_file())
                .unwrap_or(false);
            match resolve(app, &resource.id) {
                Ok((path, source)) => ResourceStatus {
                    resource: resource.clone(),
                    status: "ready".into(),
                    source: Some(source),
                    path: Some(path.to_string_lossy().into()),
                    error: None,
                    managed,
                },
                Err(error) => ResourceStatus {
                    resource: resource.clone(),
                    status: "missing".into(),
                    source: None,
                    path: None,
                    error: Some(error),
                    managed,
                },
            }
        })
        .collect()
}

#[tauri::command]
pub async fn list_resources(app: tauri::AppHandle) -> Result<Vec<ResourceStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || statuses(&app))
        .await
        .map_err(|e| e.to_string())
}

fn progress(app: &tauri::AppHandle, resource: &catalog::Resource, phase: &str, received: u64) {
    let _ = app.emit(
        "resource-progress",
        ResourceProgress {
            id: resource.id.clone(),
            phase: phase.into(),
            received,
            total: resource.download_bytes,
        },
    );
}

fn download(
    app: &tauri::AppHandle,
    resource: &catalog::Resource,
    operation: &Operation,
) -> Result<(), String> {
    let settings = config(app)?;
    let base = if settings.mirror.is_empty() {
        &catalog::catalog().release_base
    } else {
        &settings.mirror
    };
    let url = format!("{}/{}", base.trim_end_matches('/'), resource.archive);
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let directory = root(app)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    install::reject_links(&directory)?;
    let temporary = directory.join(format!(".download-{}.zip", nanoid::nanoid!()));
    let result = tauri::async_runtime::block_on(async {
        let mut response = until_cancelled(client.get(url).send(), &operation.cancel)
            .await?
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Resource download failed: {e}. Offline import is available."))?;
        if response
            .content_length()
            .is_some_and(|length| length != resource.download_bytes)
        {
            return Err("Unexpected resource download length".into());
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        let mut received = 0;
        let mut last_progress = Instant::now();
        progress(app, resource, "downloading", 0);
        loop {
            if operation.cancel.load(Ordering::Acquire) {
                return Err("Download cancelled".into());
            }
            let Some(chunk) = until_cancelled(response.chunk(), &operation.cancel)
                .await?
                .map_err(|e| e.to_string())?
            else {
                break;
            };
            received += chunk.len() as u64;
            if received > resource.download_bytes {
                return Err("Resource download exceeded size limit".into());
            }
            output.write_all(&chunk).map_err(|e| e.to_string())?;
            if last_progress.elapsed() >= Duration::from_millis(150) {
                progress(app, resource, "downloading", received);
                last_progress = Instant::now();
            }
        }
        drop(output);
        progress(app, resource, "verifying", received);
        install::install_archive_validated(
            &temporary,
            &managed_dir(app, resource)?,
            resource,
            &operation.cancel,
            |entry| probe::validate(&resource.id, entry),
        )?;
        Ok(())
    });
    let _ = fs::remove_file(temporary);
    result
}

async fn until_cancelled<T>(
    future: impl std::future::Future<Output = T>,
    cancel: &AtomicBool,
) -> Result<T, String> {
    tokio::pin!(future);
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("Download cancelled".into());
        }
        tokio::select! {
            result = &mut future => return Ok(result),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}

#[tauri::command]
pub async fn install_resource(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resource = catalog::resource(&id)?;
        catalog::check_platform(resource)?;
        let operation = Operation::begin(&id)?;
        let result = download(&app, resource, &operation);
        let _ = app.emit("resource-operation-ended", &id);
        let _ = app.emit("resources-changed", ());
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_resource_download(id: String) -> Result<(), String> {
    if let Some((_, Some(cancel))) = operations().lock().map_err(|e| e.to_string())?.get(&id) {
        cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub async fn import_resource(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resource = catalog::resource(&id)?;
        catalog::check_platform(resource)?;
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Resource ZIP", &["zip"])
            .pick_file()
        else {
            return Ok(());
        };
        let operation = Operation::begin(&id)?;
        install::install_archive_validated(
            &path,
            &managed_dir(&app, resource)?,
            resource,
            &operation.cancel,
            |entry| probe::validate(&resource.id, entry),
        )?;
        let _ = app.emit("resources-changed", ());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn select_local_resource(
    app: tauri::AppHandle,
    id: String,
    clear: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        catalog::resource(&id)?;
        if !["ffmpeg", "chromium", "java"].contains(&id.as_str()) {
            return Err("Use verified offline import for this resource".into());
        }
        let _operation = Operation::begin(&id)?;
        if clear {
            update_config(&app, |config| {
                config.local.remove(&id);
            })?;
        } else {
            let Some(path) = rfd::FileDialog::new()
                .add_filter("Executable", &["exe"])
                .pick_file()
            else {
                return Ok(());
            };
            check_candidate(&id, &path)?;
            update_config(&app, |config| {
                config.local.insert(id, path);
            })?;
        }
        let _ = app.emit("resources-changed", ());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_resource(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resource = catalog::resource(&id)?;
        let _operation = Operation::begin(&id)?;
        let directory = managed_dir(&app, resource)?;
        install::reject_links(&directory)?;
        if directory.exists() {
            let base = root(&app)?.canonicalize().map_err(|e| e.to_string())?;
            let target = directory.canonicalize().map_err(|e| e.to_string())?;
            if !target.starts_with(&base) || target == base {
                return Err("Unsafe managed resource directory".into());
            }
            fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("resources-changed", ());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_resource_mirror(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.is_empty() {
        let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(
                "Use an HTTPS resource directory URL without credentials, query or fragment".into(),
            );
        }
    }
    update_config(&app, |config| config.mirror = url)
}
#[tauri::command]
pub fn get_resource_mirror(app: tauri::AppHandle) -> Result<String, String> {
    Ok(config(&app)?.mirror)
}

#[tauri::command]
pub async fn get_resource_paths(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ids.into_iter()
            .map(|id| {
                let (path, _) = resolve(&app, &id)?;
                Ok((id, path.to_string_lossy().into()))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn read_ocr_asset(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<(Vec<u8>, &'static str), String> {
    use sha2::{Digest, Sha256};
    let (id, file) = catalog::ocr_request(path)?;
    let _lease = lease(id)?;
    let resource = catalog::resource(id)?;
    let (entry, _) = resolve(app, id)?;
    let base = entry.parent().ok_or("Missing OCR directory")?;
    let expected = resource
        .files
        .iter()
        .find(|f| f.path == file)
        .ok_or("Unknown OCR resource")?;
    let target = base.join(install::safe_relative(file)?);
    install::reject_links(&target)?;
    let bytes = fs::read(target).map_err(|e| e.to_string())?;
    if bytes.len() as u64 != expected.bytes
        || format!("{:x}", Sha256::digest(&bytes)) != expected.sha256
    {
        return Err("OCR resource file is corrupted".into());
    }
    let mime = if file.ends_with(".js") {
        "application/javascript"
    } else if file.ends_with(".wasm") {
        "application/wasm"
    } else {
        "application/octet-stream"
    };
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_mutations_exclude_active_use_and_unlock_on_failure() {
        let active = lease("ffmpeg").unwrap();
        assert!(Operation::begin("ffmpeg").is_err());
        drop(active);
        let changing = Operation::begin("ffmpeg").unwrap();
        assert!(lease("ffmpeg").is_err());
        assert!(Operation::begin("ffmpeg").is_err());
        drop(changing);
        assert!(lease("ffmpeg").is_ok());
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_stalled_network_future() {
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            flag.store(true, Ordering::Release);
        });
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            until_cancelled(std::future::pending::<()>(), &cancel),
        )
        .await;
        assert!(result.unwrap().is_err());
    }
}
