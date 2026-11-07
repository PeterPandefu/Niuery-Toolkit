use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::State as TauriState;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio_util::io::ReaderStream;

const MAX_UPLOAD_FILES: usize = 100;
const MAX_UPLOAD_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_BATCH_BYTES: usize = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedItem {
    id: String,
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    #[serde(default)]
    is_text: bool,
    #[serde(default)]
    content: Option<String>,
    #[serde(default = "now_millis")]
    created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicSharedItem {
    id: String,
    name: String,
    is_directory: bool,
    size: u64,
    is_text: bool,
    content: Option<String>,
    path: String,
    created_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileListQuery {
    directory_id: Option<String>,
    path: Option<String>,
}

#[derive(Deserialize)]
struct PublicTextInput {
    text: String,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareServerInfo {
    url: String,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAddress {
    interface_name: String,
    address: String,
    is_ipv6: bool,
}

struct PublicState {
    token: String,
    items: Arc<RwLock<Vec<SharedItem>>>,
    upload_dir: PathBuf,
    persistence_path: PathBuf,
    app: Option<tauri::AppHandle>,
    updates: broadcast::Sender<()>,
}

struct PendingUploads {
    paths: Vec<PathBuf>,
    committed: bool,
}

struct RemoveFileOnDrop(PathBuf);

impl Drop for RemoveFileOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl Drop for PendingUploads {
    fn drop(&mut self) {
        if !self.committed {
            for path in &self.paths {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn notify_shared_items_changed(updates: &broadcast::Sender<()>, app: Option<&tauri::AppHandle>) {
    let _ = updates.send(());
    if let Some(app) = app {
        let _ = app.emit("file-share-updated", ());
    }
}

struct RunningServer {
    info: ShareServerInfo,
    task: tokio::task::JoinHandle<()>,
}

pub struct FileShareState {
    items: Arc<RwLock<Vec<SharedItem>>>,
    server: Mutex<Option<RunningServer>>,
    persistence: Mutex<PersistenceState>,
    updates: broadcast::Sender<()>,
}

#[derive(Default)]
struct PersistenceState {
    loaded: bool,
    path: Option<PathBuf>,
}

impl Default for FileShareState {
    fn default() -> Self {
        Self {
            items: Arc::new(RwLock::new(Vec::new())),
            server: Mutex::new(None),
            persistence: Mutex::new(PersistenceState::default()),
            updates: broadcast::channel(32).0,
        }
    }
}

async fn ensure_loaded(state: &FileShareState, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut persistence = state.persistence.lock().await;
    if let Some(path) = persistence.path.as_ref() {
        if persistence.loaded {
            return Ok(path.clone());
        }
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("file-share-items.json");
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    let mut items = match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice::<Vec<SharedItem>>(&bytes)
            .map_err(|error| format!("无法读取共享列表：{error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    items.retain(|item| item.is_text || PathBuf::from(&item.path).exists());
    *state.items.write().await = items;
    persistence.path = Some(path.clone());
    persistence.loaded = true;
    Ok(path)
}

async fn persist_items(path: &FsPath, items: &[SharedItem]) -> Result<(), String> {
    let bytes = serde_json::to_vec(items).map_err(|error| error.to_string())?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|error| format!("无法保存共享列表：{error}"))
}

async fn persist_and_replace(
    path: &FsPath,
    current: &mut Vec<SharedItem>,
    candidate: Vec<SharedItem>,
) -> Result<(), String> {
    persist_items(path, &candidate).await?;
    *current = candidate;
    Ok(())
}

#[tauri::command]
pub async fn list_shared_items(
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<Vec<SharedItem>, String> {
    ensure_loaded(&state, &app).await?;
    Ok(state.items.read().await.clone())
}

#[tauri::command]
pub async fn add_shared_paths(
    paths: Vec<String>,
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<Vec<SharedItem>, String> {
    let persistence_path = ensure_loaded(&state, &app).await?;
    let mut items = state.items.write().await;
    let mut candidate = items.clone();
    for value in paths {
        let path = PathBuf::from(&value);
        let metadata =
            std::fs::metadata(&path).map_err(|error| format!("无法读取所选路径：{error}"))?;
        if !metadata.is_file() && !metadata.is_dir() {
            continue;
        }
        if candidate
            .iter()
            .any(|item| PathBuf::from(&item.path) == path)
        {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("共享项目")
            .to_string();
        candidate.push(SharedItem {
            id: nanoid::nanoid!(),
            name,
            path: value,
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            is_text: false,
            content: None,
            created_at: now_millis(),
        });
    }
    persist_and_replace(&persistence_path, &mut items, candidate).await?;
    notify_shared_items_changed(&state.updates, Some(&app));
    Ok(items.clone())
}

#[tauri::command]
pub async fn share_text(
    text: String,
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<Vec<SharedItem>, String> {
    if text.trim().is_empty() {
        return Err("分享内容不能为空".into());
    }
    let persistence_path = ensure_loaded(&state, &app).await?;
    let name = text.chars().take(20).collect::<String>();
    let name = if text.chars().count() > 20 {
        format!("{name}…")
    } else {
        name
    };
    let mut items = state.items.write().await;
    let mut candidate = items.clone();
    candidate.push(SharedItem {
        id: nanoid::nanoid!(),
        name,
        path: String::new(),
        is_directory: false,
        size: text.len() as u64,
        is_text: true,
        content: Some(text),
        created_at: now_millis(),
    });
    persist_and_replace(&persistence_path, &mut items, candidate).await?;
    notify_shared_items_changed(&state.updates, Some(&app));
    Ok(items.clone())
}

#[tauri::command]
pub async fn remove_shared_item(
    id: String,
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = ensure_loaded(&state, &app).await?;
    let mut items = state.items.write().await;
    let mut candidate = items.clone();
    candidate.retain(|item| item.id != id);
    persist_and_replace(&path, &mut items, candidate).await?;
    notify_shared_items_changed(&state.updates, Some(&app));
    Ok(())
}

#[tauri::command]
pub async fn reveal_shared_item(
    id: String,
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    ensure_loaded(&state, &app).await?;
    let path = state
        .items
        .read()
        .await
        .iter()
        .find(|item| item.id == id && !item.is_text)
        .map(|item| PathBuf::from(&item.path))
        .ok_or_else(|| "共享文件不存在".to_string())?;
    if !path.exists() {
        return Err("共享文件已不存在".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn clear_shared_items(
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = ensure_loaded(&state, &app).await?;
    let mut items = state.items.write().await;
    persist_and_replace(&path, &mut items, Vec::new()).await?;
    notify_shared_items_changed(&state.updates, Some(&app));
    Ok(())
}

#[tauri::command]
pub async fn start_file_share(
    address: String,
    state: TauriState<'_, FileShareState>,
    app: tauri::AppHandle,
) -> Result<ShareServerInfo, String> {
    let persistence_path = ensure_loaded(&state, &app).await?;
    let mut running = state.server.lock().await;
    if let Some(server) = running.as_ref() {
        return Ok(server.info.clone());
    }
    let ip = address
        .parse::<std::net::IpAddr>()
        .map_err(|error| format!("无效的网络地址：{error}"))?;
    let available = local_ip_address::list_afinet_netifas()
        .map_err(|error| format!("无法读取网络接口：{error}"))?
        .into_iter()
        .any(|(_, value)| value == ip);
    if !available || ip.is_loopback() || ip.is_unspecified() {
        return Err("所选网络地址当前不可用".into());
    }
    let listener = TcpListener::bind(std::net::SocketAddr::new(ip, 0))
        .await
        .map_err(|error| format!("无法启动局域网服务：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = nanoid::nanoid!(32);
    let upload_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("file-share-uploads");
    tokio::fs::create_dir_all(&upload_dir)
        .await
        .map_err(|error| error.to_string())?;
    let public_state = Arc::new(PublicState {
        token: token.clone(),
        items: state.items.clone(),
        upload_dir,
        persistence_path,
        app: Some(app.clone()),
        updates: state.updates.clone(),
    });
    let router = create_router(public_state);
    let host = if ip.is_ipv6() {
        format!("[{ip}]")
    } else {
        ip.to_string()
    };
    let info = ShareServerInfo {
        url: format!("http://{host}:{port}/s/{token}"),
        port,
    };
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    *running = Some(RunningServer {
        info: info.clone(),
        task,
    });
    Ok(info)
}

#[tauri::command]
pub fn list_file_share_addresses() -> Result<Vec<ShareAddress>, String> {
    let mut addresses = local_ip_address::list_afinet_netifas()
        .map_err(|error| format!("无法读取网络接口：{error}"))?
        .into_iter()
        .filter(|(_, address)| {
            !address.is_loopback()
                && !address.is_unspecified()
                && !matches!(address, std::net::IpAddr::V6(value) if value.is_unicast_link_local())
        })
        .map(|(interface_name, address)| ShareAddress {
            interface_name,
            address: address.to_string(),
            is_ipv6: address.is_ipv6(),
        })
        .collect::<Vec<_>>();
    addresses.sort_by(|a, b| {
        a.is_ipv6
            .cmp(&b.is_ipv6)
            .then_with(|| a.interface_name.cmp(&b.interface_name))
    });
    addresses.dedup_by(|a, b| a.address == b.address);
    Ok(addresses)
}

#[tauri::command]
pub async fn stop_file_share(state: TauriState<'_, FileShareState>) -> Result<(), String> {
    if let Some(server) = state.server.lock().await.take() {
        server.task.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_file_share_info(
    state: TauriState<'_, FileShareState>,
) -> Result<Option<ShareServerInfo>, String> {
    Ok(state
        .server
        .lock()
        .await
        .as_ref()
        .map(|server| server.info.clone()))
}

async fn visitor_page(
    Path(token): Path<String>,
    State(state): State<Arc<PublicState>>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let page = VISITOR_HTML.replace("__TOKEN__", &token);
    Html(page).into_response()
}

fn create_router(state: Arc<PublicState>) -> Router {
    Router::new()
        .route("/s/{token}", get(visitor_page))
        .route("/s/{token}/api/files", get(public_file_list))
        .route("/s/{token}/api/events", get(public_events))
        .route("/s/{token}/api/download/{id}", get(download_item))
        .route(
            "/s/{token}/api/upload",
            post(upload_file).layer(DefaultBodyLimit::max(MAX_UPLOAD_BATCH_BYTES)),
        )
        .route(
            "/s/{token}/api/text",
            post(upload_text).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .fallback(not_found)
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

async fn public_file_list(
    Path(token): Path<String>,
    State(state): State<Arc<PublicState>>,
    Query(query): Query<FileListQuery>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let shared_items = state.items.read().await;
    if let Some(directory_id) = query.directory_id {
        let Some(root) = shared_items
            .iter()
            .find(|item| item.id == directory_id && item.is_directory)
        else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let relative = query.path.unwrap_or_default();
        let Some(directory) = resolve_shared_path(&root.path, &relative) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        match tokio::fs::metadata(&directory).await {
            Ok(metadata) if metadata.is_dir() => {}
            _ => return StatusCode::NOT_FOUND.into_response(),
        }
        let root_path = match tokio::fs::canonicalize(&root.path).await {
            Ok(path) => path,
            Err(_) => return StatusCode::NOT_FOUND.into_response(),
        };
        let root_id = root.id.clone();
        drop(shared_items);
        let entries = match tokio::fs::read_dir(directory).await {
            Ok(entries) => entries,
            Err(_) => return StatusCode::NOT_FOUND.into_response(),
        };
        let mut items = Vec::new();
        let mut entries = entries;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_type = match entry.file_type().await {
                Ok(file_type) if !file_type.is_symlink() => file_type,
                _ => continue,
            };
            if !file_type.is_file() && !file_type.is_dir() {
                continue;
            }
            let metadata = match entry.metadata().await {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let child_path = if relative.is_empty() {
                entry.file_name().to_string_lossy().into_owned()
            } else {
                format!("{relative}/{}", entry.file_name().to_string_lossy())
            };
            let canonical_child = match tokio::fs::canonicalize(entry.path()).await {
                Ok(path) => path,
                Err(_) => continue,
            };
            if !canonical_child.starts_with(&root_path) {
                continue;
            }
            items.push(PublicSharedItem {
                id: root_id.clone(),
                name: entry.file_name().to_string_lossy().into_owned(),
                is_directory: file_type.is_dir(),
                size: metadata.len(),
                is_text: false,
                content: None,
                path: child_path,
                created_at: 0,
            });
        }
        return Json(items).into_response();
    }
    Json(
        shared_items
            .iter()
            .map(|item| PublicSharedItem {
                id: item.id.clone(),
                name: item.name.clone(),
                is_directory: item.is_directory,
                size: item.size,
                is_text: item.is_text,
                content: item.content.clone(),
                path: String::new(),
                created_at: item.created_at,
            })
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn public_events(
    Path(token): Path<String>,
    State(state): State<Arc<PublicState>>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let receiver = state.updates.subscribe();
    let events = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(()) => {
                    let event = Event::default().data("shared-items");
                    return Some((Ok::<_, Infallible>(event), receiver));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(events)
        .keep_alive(KeepAlive::default())
        .into_response()
}

async fn download_item(
    Path((token, id)): Path<(String, String)>,
    State(state): State<Arc<PublicState>>,
    headers: HeaderMap,
    Query(query): Query<FileListQuery>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(item) = state
        .items
        .read()
        .await
        .iter()
        .find(|item| item.id == id)
        .cloned()
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if item.is_text {
        let content = item.content.unwrap_or_default();
        let disposition = format!(
            "attachment; filename=\"{}.txt\"; filename*=UTF-8''{}.txt",
            ascii_filename(&item.name),
            percent_encode(&item.name)
        );
        let mut response = Response::new(Body::from(content));
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&disposition)
                .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        );
        return response;
    }
    let relative_path = query.path.unwrap_or_default();
    let path = if relative_path.is_empty() {
        PathBuf::from(&item.path)
    } else if item.is_directory {
        match resolve_shared_path(&item.path, &relative_path) {
            Some(path) => path,
            None => return StatusCode::NOT_FOUND.into_response(),
        }
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(value) => value,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    if metadata.is_dir() {
        let zip_path =
            std::env::temp_dir().join(format!("niuery-share-{}.zip", nanoid::nanoid!(10)));
        let source = path.clone();
        let output = zip_path.clone();
        if tokio::task::spawn_blocking(move || zip_directory(&source, &output))
            .await
            .ok()
            .and_then(Result::ok)
            .is_none()
        {
            let _ = tokio::fs::remove_file(&zip_path).await;
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        let name = if relative_path.is_empty() {
            item.name
        } else {
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("共享文件夹")
                .to_string()
        };
        return stream_file(
            zip_path.clone(),
            format!("{name}.zip"),
            None,
            Some(zip_path),
        )
        .await;
    }
    let download_name = if relative_path.is_empty() {
        item.name
    } else {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("shared-file")
            .to_string()
    };
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, metadata.len()));
    if headers.contains_key(header::RANGE) && range.is_none() {
        let mut response = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes */{}", metadata.len())).unwrap(),
        );
        return response;
    }
    stream_file(path, download_name, range, None).await
}

fn resolve_shared_path(root: &str, relative: &str) -> Option<PathBuf> {
    let relative_path = FsPath::new(relative);
    if relative_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let candidate = std::fs::canonicalize(canonical_root.join(relative_path)).ok()?;
    candidate.starts_with(&canonical_root).then_some(candidate)
}

async fn stream_file(
    path: PathBuf,
    name: String,
    range: Option<(u64, u64)>,
    cleanup_path: Option<PathBuf>,
) -> Response {
    let cleanup = cleanup_path.map(RemoveFileOnDrop);
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let size = match file.metadata().await {
        Ok(meta) => meta.len(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if size == 0 {
        let mut response = Response::new(Body::empty());
        let disposition = format!(
            "attachment; filename=\"{}\"; filename*=UTF-8''{}",
            ascii_filename(&name),
            percent_encode(&name)
        );
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&disposition)
                .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        );
        response
            .headers_mut()
            .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        response
            .headers_mut()
            .insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        return response;
    }
    let (start, end) = range.unwrap_or((0, size.saturating_sub(1)));
    if tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(start))
        .await
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let reader = file.take(end.saturating_sub(start).saturating_add(1));
    let chunks = stream::unfold(
        (ReaderStream::new(reader), cleanup),
        |(mut reader, cleanup)| async move {
            reader.next().await.map(|chunk| (chunk, (reader, cleanup)))
        },
    );
    let mut response = Response::new(Body::from_stream(chunks));
    *response.status_mut() = if range.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let disposition = format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii_filename(&name),
        percent_encode(&name)
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from(end.saturating_sub(start).saturating_add(1)),
    );
    if range.is_some() {
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap(),
        );
    }
    response
}

async fn upload_file(
    Path(token): Path<String>,
    State(state): State<Arc<PublicState>>,
    mut multipart: Multipart,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut saved = Vec::new();
    let mut pending = PendingUploads {
        paths: Vec::new(),
        committed: false,
    };
    let mut total_size = 0_u64;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        };
        let Some(original) = field.file_name().map(str::to_string) else {
            continue;
        };
        if saved.len() >= MAX_UPLOAD_FILES {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        let safe_name = original
            .replace(['\\', '/'], "_")
            .chars()
            .filter(|ch| !ch.is_control())
            .collect::<String>();
        if safe_name.is_empty() {
            continue;
        }
        let path = state
            .upload_dir
            .join(format!("{}-{safe_name}", nanoid::nanoid!(8)));
        let mut file = match tokio::fs::File::create(&path).await {
            Ok(file) => file,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        pending.paths.push(path.clone());
        let mut size = 0_u64;
        let mut field = field;
        loop {
            match field.chunk().await {
                Ok(Some(bytes)) => {
                    size += bytes.len() as u64;
                    total_size = total_size.saturating_add(bytes.len() as u64);
                    if size > MAX_UPLOAD_FILE_BYTES || total_size > MAX_UPLOAD_BATCH_BYTES as u64 {
                        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
                    }
                    if file.write_all(&bytes).await.is_err() {
                        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                    }
                }
                Ok(None) => break,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
        }
        saved.push(SharedItem {
            id: nanoid::nanoid!(),
            name: safe_name,
            path: path.to_string_lossy().into_owned(),
            is_directory: false,
            size,
            is_text: false,
            content: None,
            created_at: now_millis(),
        });
    }
    let mut items = state.items.write().await;
    let mut candidate = items.clone();
    candidate.extend(saved.clone());
    if let Err(error) = persist_and_replace(&state.persistence_path, &mut items, candidate).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error).into_response();
    }
    pending.committed = true;
    notify_shared_items_changed(&state.updates, state.app.as_ref());
    Json(saved).into_response()
}

async fn upload_text(
    Path(token): Path<String>,
    State(state): State<Arc<PublicState>>,
    Json(input): Json<PublicTextInput>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    if input.text.trim().is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if input.text.len() > 1024 * 1024 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let name = input.text.chars().take(20).collect::<String>();
    let name = if input.text.chars().count() > 20 {
        format!("{name}…")
    } else {
        name
    };
    let item = SharedItem {
        id: nanoid::nanoid!(),
        name,
        path: String::new(),
        is_directory: false,
        size: input.text.len() as u64,
        is_text: true,
        content: Some(input.text),
        created_at: now_millis(),
    };
    let mut items = state.items.write().await;
    let mut candidate = items.clone();
    candidate.push(item.clone());
    if let Err(error) = persist_and_replace(&state.persistence_path, &mut items, candidate).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error).into_response();
    }
    notify_shared_items_changed(&state.updates, state.app.as_ref());
    Json(item).into_response()
}

async fn not_found() -> impl IntoResponse {
    StatusCode::NOT_FOUND
}

fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let raw = value.strip_prefix("bytes=")?;
    if raw.contains(',') || size == 0 {
        return None;
    }
    let (start, end) = raw.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(size);
        return (suffix > 0).then_some((size - suffix, size - 1));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        size.saturating_sub(1)
    } else {
        end.parse::<u64>().ok()?.min(size.saturating_sub(1))
    };
    (start < size && start <= end).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::{
        create_router, parse_range, persist_and_replace, stream_file, zip_directory, PublicState,
        SharedItem,
    };
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Request, StatusCode};
    use std::io::Read;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn failed_persistence_keeps_shared_items_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing").join("items.json");
        let mut current = vec![SharedItem {
            id: "existing".into(),
            name: "现有项目".into(),
            path: String::new(),
            is_directory: false,
            size: 0,
            is_text: true,
            content: Some("原内容".into()),
            created_at: 1,
        }];
        let candidate = Vec::new();

        assert!(persist_and_replace(&path, &mut current, candidate)
            .await
            .is_err());
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].id, "existing");
    }

    #[test]
    fn zip_directory_skips_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let outside = directory.path().join("outside");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(source.join("included.txt"), "inside").unwrap();
        std::fs::write(outside.join("secret.txt"), "outside").unwrap();

        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_dir(&outside, source.join("linked"));
        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&outside, source.join("linked"));
        if link_result.is_err() {
            return;
        }

        let archive_path = directory.path().join("archive.zip");
        zip_directory(&source, &archive_path).unwrap();
        let file = std::fs::File::open(archive_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("included.txt").is_ok());
        assert!(archive.by_name("linked/secret.txt").is_err());
    }
    use tower::ServiceExt;

    #[test]
    fn parses_supported_byte_ranges_and_rejects_invalid_ranges() {
        assert_eq!(parse_range("bytes=0-0", 10), Some((0, 0)));
        assert_eq!(parse_range("bytes=3-", 10), Some((3, 9)));
        assert_eq!(parse_range("bytes=-4", 10), Some((6, 9)));
        assert_eq!(parse_range("bytes=0-99", 10), Some((0, 9)));
        assert_eq!(parse_range("bytes=10-", 10), None);
        assert_eq!(parse_range("bytes=-0", 10), None);
        assert_eq!(parse_range("bytes=1-2,4-5", 10), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("items=0-1", 10), None);
    }

    #[tokio::test]
    async fn temporary_download_is_removed_after_completion_or_disconnect() {
        let directory = tempfile::tempdir().unwrap();
        let completed_path = directory.path().join("completed.zip");
        tokio::fs::write(&completed_path, b"archive").await.unwrap();
        let response = stream_file(
            completed_path.clone(),
            "completed.zip".into(),
            None,
            Some(completed_path.clone()),
        )
        .await;
        assert_eq!(
            to_bytes(response.into_body(), usize::MAX).await.unwrap(),
            "archive"
        );
        assert!(!completed_path.exists());

        let disconnected_path = directory.path().join("disconnected.zip");
        tokio::fs::write(&disconnected_path, b"archive")
            .await
            .unwrap();
        let response = stream_file(
            disconnected_path.clone(),
            "disconnected.zip".into(),
            None,
            Some(disconnected_path.clone()),
        )
        .await;
        drop(response);
        assert!(!disconnected_path.exists());
    }

    #[tokio::test]
    async fn http_routes_list_download_and_accept_uploads_without_exposing_host_paths() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("sample.txt");
        tokio::fs::write(&file_path, b"abcdef").await.unwrap();
        let shared_folder = directory.path().join("shared-folder");
        let nested_folder = shared_folder.join("nested");
        tokio::fs::create_dir_all(&nested_folder).await.unwrap();
        tokio::fs::write(nested_folder.join("inside.txt"), b"nested data")
            .await
            .unwrap();
        let persistence_path = directory.path().join("shared-items.json");
        let state = Arc::new(PublicState {
            token: "test-token".into(),
            items: Arc::new(RwLock::new(vec![
                SharedItem {
                    id: "file-id".into(),
                    name: "sample.txt".into(),
                    path: file_path.to_string_lossy().into_owned(),
                    is_directory: false,
                    size: 6,
                    is_text: false,
                    content: None,
                    created_at: 10,
                },
                SharedItem {
                    id: "text-id".into(),
                    name: "共享文本".into(),
                    path: String::new(),
                    is_directory: false,
                    size: 6,
                    is_text: true,
                    content: Some("secret text".into()),
                    created_at: 20,
                },
                SharedItem {
                    id: "folder-id".into(),
                    name: "shared-folder".into(),
                    path: shared_folder.to_string_lossy().into_owned(),
                    is_directory: true,
                    size: 0,
                    is_text: false,
                    content: None,
                    created_at: 30,
                },
            ])),
            upload_dir: directory.path().join("uploads"),
            persistence_path: persistence_path.clone(),
            app: None,
            updates: tokio::sync::broadcast::channel(32).0,
        });
        tokio::fs::create_dir_all(&state.upload_dir).await.unwrap();
        let mut updates = state.updates.subscribe();
        let router = create_router(state);

        let list = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/files")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list.status(), StatusCode::OK);
        let list = to_bytes(list.into_body(), usize::MAX).await.unwrap();
        let list: serde_json::Value = serde_json::from_slice(&list).unwrap();
        assert_eq!(list[0]["name"], "sample.txt");
        assert_eq!(list[1]["content"], "secret text");
        assert_eq!(list[0]["path"], "");
        assert!(list[0]["createdAt"].as_u64().is_some());

        let nested_list = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/files?directoryId=folder-id&path=nested")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(nested_list.status(), StatusCode::OK);
        let nested_list: serde_json::Value =
            serde_json::from_slice(&to_bytes(nested_list.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(nested_list[0]["name"], "inside.txt");
        assert_eq!(nested_list[0]["path"], "nested/inside.txt");

        let folder_download = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/download/folder-id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(folder_download.status(), StatusCode::OK);
        let folder_download = to_bytes(folder_download.into_body(), usize::MAX)
            .await
            .unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(folder_download)).unwrap();
        let mut nested_file = archive.by_name("nested/inside.txt").unwrap();
        let mut nested_contents = String::new();
        nested_file.read_to_string(&mut nested_contents).unwrap();
        assert_eq!(nested_contents, "nested data");

        let nested_download = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/download/folder-id?path=nested/inside.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(nested_download.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(nested_download.into_body(), usize::MAX)
                .await
                .unwrap(),
            "nested data"
        );

        let traversal = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/files?directoryId=folder-id&path=..%2F..")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(traversal.status(), StatusCode::NOT_FOUND);

        let download = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/s/test-token/api/download/file-id")
                    .header(header::RANGE, "bytes=1-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(download.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(download.headers()[header::CONTENT_RANGE], "bytes 1-3/6");
        assert_eq!(
            to_bytes(download.into_body(), usize::MAX).await.unwrap(),
            "bcd"
        );

        let upload_body = concat!(
            "--XBOUNDARY\r\n",
            "Content-Disposition: form-data; name=\"file\"; filename=\"new.txt\"\r\n",
            "Content-Type: text/plain\r\n\r\n",
            "upload data\r\n",
            "--XBOUNDARY--\r\n"
        );
        let upload = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/s/test-token/api/upload")
                    .header(
                        header::CONTENT_TYPE,
                        "multipart/form-data; boundary=XBOUNDARY",
                    )
                    .body(Body::from(upload_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(upload.status(), StatusCode::OK);
        let saved = to_bytes(upload.into_body(), usize::MAX).await.unwrap();
        let saved: Vec<SharedItem> = serde_json::from_slice(&saved).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].name, "new.txt");
        assert_eq!(
            tokio::fs::read_to_string(&saved[0].path).await.unwrap(),
            "upload data"
        );
        assert!(updates.try_recv().is_ok());
        let text = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/s/test-token/api/text")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"text":"guest note"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(text.status(), StatusCode::OK);
        let text: SharedItem =
            serde_json::from_slice(&to_bytes(text.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(text.content.as_deref(), Some("guest note"));
        assert!(text.created_at > 0);
        assert!(updates.try_recv().is_ok());
        let persisted: Vec<SharedItem> =
            serde_json::from_slice(&tokio::fs::read(persistence_path).await.unwrap()).unwrap();
        assert_eq!(persisted.len(), 5);

        let denied = router
            .oneshot(
                Request::builder()
                    .uri("/s/wrong-token/api/files")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn oversized_upload_batch_is_rejected_and_partial_files_are_removed() {
        let directory = tempfile::tempdir().unwrap();
        let upload_dir = directory.path().join("uploads");
        tokio::fs::create_dir_all(&upload_dir).await.unwrap();
        let state = Arc::new(PublicState {
            token: "test-token".into(),
            items: Arc::new(RwLock::new(Vec::new())),
            upload_dir: upload_dir.clone(),
            persistence_path: directory.path().join("shared-items.json"),
            app: None,
            updates: tokio::sync::broadcast::channel(32).0,
        });
        let router = create_router(state);
        let mut body = String::new();
        for index in 0..=super::MAX_UPLOAD_FILES {
            body.push_str(&format!(
                "--XBOUNDARY\r\nContent-Disposition: form-data; name=\"file{index}\"; filename=\"file-{index}.txt\"\r\nContent-Type: text/plain\r\n\r\ndata\r\n"
            ));
        }
        body.push_str("--XBOUNDARY--\r\n");
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/s/test-token/api/upload")
                    .header(
                        header::CONTENT_TYPE,
                        "multipart/form-data; boundary=XBOUNDARY",
                    )
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let mut entries = tokio::fs::read_dir(upload_dir).await.unwrap();
        assert!(entries.next_entry().await.unwrap().is_none());
    }
}

fn zip_directory(source: &FsPath, output: &FsPath) -> Result<(), String> {
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    let file = std::fs::File::create(output).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut pending = vec![source.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let relative = path
                .strip_prefix(source)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_symlink()
            {
                continue;
            }
            if path.is_dir() {
                pending.push(path.clone());
                zip.add_directory(format!("{relative}/"), options)
                    .map_err(|error| error.to_string())?;
            } else {
                zip.start_file(relative, options)
                    .map_err(|error| error.to_string())?;
                let mut input = std::fs::File::open(path).map_err(|error| error.to_string())?;
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
                    if count == 0 {
                        break;
                    }
                    zip.write_all(&buffer[..count])
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn ascii_filename(name: &str) -> String {
    name.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || " ._-".contains(ch) {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

const VISITOR_HTML: &str = r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>局域网文件共享</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#252b32;font:15px system-ui,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:36px auto;padding:0 20px}header,.toolbar,.row,.crumbs,.form-row{display:flex;align-items:center;gap:10px}header{justify-content:space-between}h1{font-size:22px;margin:0 0 5px}p,.muted{color:#69727c;margin:0}.toolbar{margin-top:22px;flex-wrap:wrap}.toolbar input[type=search]{min-width:180px;flex:1}button,.pick,input,textarea{font:inherit}button,.pick{border:1px solid #ccd2d8;background:white;border-radius:5px;padding:8px 12px;color:#26313b;cursor:pointer}button.primary,.pick{background:#176d61;border-color:#176d61;color:white}.pick input{display:none}input[type=search],textarea{border:1px solid #ccd2d8;border-radius:5px;padding:8px 10px;color:inherit;background:white}textarea{width:100%;resize:vertical}.crumbs{margin:16px 0;color:#53606b;flex-wrap:wrap}.crumbs button{padding:3px 5px;border:0;color:#176d61}.list,.compose{margin-top:14px;background:white;border:1px solid #e0e4e8;border-radius:6px;overflow:hidden}.row{justify-content:space-between;padding:12px 15px;border-bottom:1px solid #edf0f2}.row:last-child{border:0}.row-main{min-width:0;flex:1}.name{overflow-wrap:anywhere;font-weight:500}.size{color:#7b838b;font-size:13px;margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}.empty{padding:30px;text-align:center;color:#7b838b}.compose{padding:14px}.compose h2{font-size:15px;margin:0 0 10px}.form-row{justify-content:flex-end;margin-top:9px}#status{min-height:22px;margin-top:10px;color:#176d61}@media(max-width:560px){main{margin:22px auto;padding:0 14px}header{align-items:flex-start;flex-direction:column}.toolbar>*{flex:1}.row{align-items:flex-start}.row button{flex:none}}
</style></head><body><main>
<header><div><h1>局域网文件共享</h1><p>浏览、下载共享内容，或向共享设备发送文件和文本。</p></div><button id="refresh">刷新</button></header>
<div class="toolbar"><input id="search" type="search" placeholder="搜索当前目录"><label><input id="select-all" type="checkbox"> 全选当前目录</label><button id="download-selected" disabled>批量下载</button><label class="pick">上传文件<input id="upload" type="file" multiple></label></div>
<nav id="crumbs" class="crumbs" aria-label="目录路径"></nav><section id="list" class="list"><div class="empty">正在加载…</div></section>
<section class="compose"><h2>发送文本</h2><textarea id="text" rows="3" placeholder="输入要共享的文本"></textarea><div class="form-row"><button id="send-text" class="primary">发送</button></div></section>
<div id="status" role="status"></div></main>
<script>
const base='/s/__TOKEN__', list=document.querySelector('#list'), status=document.querySelector('#status'), selected=new Map();let visibleItems=[];
const selectionKey=item=>item.id+'|'+item.path;
let current={id:null,name:'',path:''};let parents=[];
const escPath=value=>encodeURIComponent(value);
const downloadUrl=item=>base+'/api/download/'+escPath(item.id)+(item.path?'?path='+escPath(item.path):'');
function updateSelection(){document.querySelector('#download-selected').disabled=!selected.size;const boxes=[...list.querySelectorAll('.item-select')];document.querySelector('#select-all').checked=boxes.length>0&&boxes.every(box=>box.checked)}
function formatSize(n){if(n<1024)return n+' B';const units=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++}while(n>=1024&&i<units.length-1);return n.toFixed(1)+' '+units[i]}
function button(label,action,primary=false){const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';b.addEventListener('click',action);return b}
function renderCrumbs(){const nav=document.querySelector('#crumbs');nav.replaceChildren();const root=button('共享列表',()=>{selected.clear();parents=[];current={id:null,name:'',path:''};load()});nav.append(root);parents.forEach((entry,index)=>{const sep=document.createElement('span');sep.textContent='/';nav.append(sep,button(entry.name,()=>{selected.clear();parents=parents.slice(0,index+1);current=entry;load()}))})}
async function load(){try{const query=current.id?'?directoryId='+escPath(current.id)+'&path='+escPath(current.path):'';const response=await fetch(base+'/api/files'+query);if(!response.ok)throw Error();const items=await response.json();renderCrumbs();const q=document.querySelector('#search').value.trim().toLocaleLowerCase();const filtered=items.filter(item=>item.name.toLocaleLowerCase().includes(q));visibleItems=filtered;const available=new Set(items.map(selectionKey));for(const key of selected.keys())if(!available.has(key))selected.delete(key);list.replaceChildren();if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=items.length?'没有匹配的项目':'此目录暂无共享内容';list.append(empty);updateSelection();return}for(const item of filtered){const row=document.createElement('div');row.className='row';const main=document.createElement('div');main.className='row-main';const name=document.createElement('div');name.className='name';name.textContent=item.name;const detail=document.createElement('div');detail.className='size';detail.textContent=item.isText?item.content:(item.isDirectory?'文件夹':formatSize(item.size));main.append(name,detail);if(!item.isText){const select=document.createElement('input');select.type='checkbox';select.className='item-select';select.dataset.itemKey=selectionKey(item);select.checked=selected.has(selectionKey(item));select.setAttribute('aria-label','选择 '+item.name);select.addEventListener('change',()=>{if(select.checked)selected.set(selectionKey(item),item);else selected.delete(selectionKey(item));updateSelection()});row.append(select)}row.append(main);if(item.isDirectory){row.append(button('打开',()=>{selected.clear();document.querySelector('#select-all').checked=false;parents.push({id:item.id,name:item.name,path:item.path});current=parents.at(-1);load()}));row.append(button('下载 ZIP',()=>{location.href=downloadUrl(item)},true))}else if(item.isText){row.append(button('复制',async()=>{try{await navigator.clipboard.writeText(item.content||'');status.textContent='已复制文本'}catch{status.textContent='复制失败'}}));row.append(button('下载',()=>{location.href=downloadUrl(item)}))}else{row.append(button('下载',()=>{location.href=downloadUrl(item)},true))}list.append(row)}updateSelection()}catch{list.innerHTML='<div class="empty">无法连接共享服务</div>'}}
document.querySelector('#refresh').addEventListener('click',load);document.querySelector('#search').addEventListener('input',load);document.querySelector('#select-all').addEventListener('change',event=>{list.querySelectorAll('.item-select').forEach(box=>{box.checked=event.target.checked;const item=visibleItems.find(value=>selectionKey(value)===box.dataset.itemKey);if(event.target.checked&&item)selected.set(selectionKey(item),item);else if(item)selected.delete(selectionKey(item))});updateSelection()});
document.querySelector('#download-selected').addEventListener('click',()=>selected.forEach(item=>{const link=document.createElement('a');link.href=downloadUrl(item);link.download='';document.body.append(link);link.click();link.remove()}));
document.querySelector('#upload').addEventListener('change',async event=>{for(const file of event.target.files){const form=new FormData();form.append('file',file);const response=await fetch(base+'/api/upload',{method:'POST',body:form});if(!response.ok){status.textContent='上传失败：'+file.name;return}}status.textContent='上传完成';event.target.value='';load()});
document.querySelector('#send-text').addEventListener('click',async()=>{const text=document.querySelector('#text').value;if(!text.trim())return;const response=await fetch(base+'/api/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});if(!response.ok){status.textContent='文本发送失败';return}document.querySelector('#text').value='';status.textContent='文本已发送';selected.clear();parents=[];current={id:null,name:'',path:''};load()});const events='EventSource'in window?new EventSource(base+'/api/events'):null;const poll=events?null:setInterval(load,3000);if(events)events.onmessage=()=>load();window.addEventListener('pagehide',()=>{events?.close();if(poll)clearInterval(poll)});load();
</script></body></html>"#;
