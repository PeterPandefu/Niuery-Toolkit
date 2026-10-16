use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x08000000;
const RENDER_TIMEOUT: Duration = Duration::from_secs(2);

struct PlantUmlWorker {
    paths: PlantUmlPaths,
    child: Child,
    stdin: ChildStdin,
    requests: Sender<()>,
    results: Receiver<Result<Vec<u8>, String>>,
}

impl Drop for PlantUmlWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static WORKERS: OnceLock<Mutex<HashMap<String, PlantUmlWorker>>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlantUmlPaths {
    pub java: PathBuf,
    pub jar: PathBuf,
}

/// Legacy layout retained for development and migration. Rendering remains local.
#[allow(dead_code)]
pub fn bundled_paths(resource_dir: &Path) -> PlantUmlPaths {
    PlantUmlPaths {
        java: resource_dir
            .join("plantuml")
            .join("jre")
            .join("bin")
            .join("java.exe"),
        jar: resource_dir.join("plantuml").join("plantuml.jar"),
    }
}

fn path_for_java(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", rest));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

pub fn command_arguments(paths: &PlantUmlPaths, format: &str) -> Vec<String> {
    vec![
        "-Djava.awt.headless=true".into(),
        "-jar".into(),
        path_for_java(&paths.jar).to_string_lossy().into_owned(),
        "-charset".into(),
        "UTF-8".into(),
        format!("-t{format}"),
        "-pipe".into(),
    ]
}

fn workers() -> &'static Mutex<HashMap<String, PlantUmlWorker>> {
    WORKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn spawn_worker(paths: &PlantUmlPaths, format: &str) -> Result<PlantUmlWorker, String> {
    let mut command = Command::new(&paths.java);
    command
        .args(command_arguments(paths, format))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动随附的 PlantUML 运行时: {error}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 PlantUML 输出")?;
    let (request_tx, request_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let is_svg = format == "svg";
    std::thread::spawn(move || {
        let mut stdout = stdout;
        for () in request_rx {
            let result = if is_svg {
                read_svg(&mut stdout)
            } else {
                read_png(&mut stdout)
            };
            if result_tx.send(result).is_err() {
                break;
            }
        }
    });
    Ok(PlantUmlWorker {
        paths: paths.clone(),
        stdin: child.stdin.take().ok_or("无法向 PlantUML 发送源码")?,
        requests: request_tx,
        results: result_rx,
        child,
    })
}

fn read_svg(stdout: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut tail = Vec::new();
    let end = b"</svg>";
    loop {
        let mut byte = [0u8; 1];
        stdout
            .read_exact(&mut byte)
            .map_err(|error| format!("PlantUML 渲染进程异常结束: {error}"))?;
        result.push(byte[0]);
        tail.push(byte[0]);
        if tail.len() > end.len() {
            tail.remove(0);
        }
        if tail == end {
            return Ok(result);
        }
    }
}

fn read_png(stdout: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut result = vec![0u8; 8];
    stdout
        .read_exact(&mut result)
        .map_err(|error| format!("PlantUML 渲染进程异常结束: {error}"))?;
    if result.as_slice() != b"\x89PNG\r\n\x1a\n" {
        return Err("PlantUML 未返回 PNG 图像数据".into());
    }
    loop {
        let mut header = [0u8; 8];
        stdout
            .read_exact(&mut header)
            .map_err(|error| format!("PlantUML 渲染进程异常结束: {error}"))?;
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        result.extend_from_slice(&header);
        let mut chunk = vec![0u8; length + 4];
        stdout
            .read_exact(&mut chunk)
            .map_err(|error| format!("PlantUML 渲染进程异常结束: {error}"))?;
        result.extend_from_slice(&chunk);
        if &header[4..] == b"IEND" {
            return Ok(result);
        }
    }
}

fn render_with_worker(
    paths: &PlantUmlPaths,
    source: &str,
    format: &str,
) -> Result<Vec<u8>, String> {
    let mut pool = workers()
        .lock()
        .map_err(|_| "PlantUML 渲染器状态异常".to_string())?;
    if pool.get(format).is_some_and(|worker| worker.paths != *paths) { pool.remove(format); }
    if !pool.contains_key(format) {
        pool.insert(format.to_owned(), spawn_worker(paths, format)?);
    }
    let result = (|| {
        let worker = pool.get_mut(format).ok_or("PlantUML 渲染器未准备就绪")?;
        worker
            .stdin
            .write_all(source.as_bytes())
            .map_err(|error| format!("无法向 PlantUML 发送源码: {error}"))?;
        if !source.ends_with('\n') && !source.ends_with('\r') {
            worker
                .stdin
                .write_all(b"\n")
                .map_err(|error| format!("无法向 PlantUML 发送源码: {error}"))?;
        }
        worker
            .stdin
            .flush()
            .map_err(|error| format!("无法向 PlantUML 发送源码: {error}"))?;
        worker
            .requests
            .send(())
            .map_err(|_| "PlantUML 渲染进程已退出".to_string())?;
        match worker.results.recv_timeout(RENDER_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = worker.child.kill();
                Err("PlantUML 渲染超时，已重启渲染进程".into())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = worker.child.kill();
                Err("PlantUML 渲染进程异常结束".into())
            }
        }
    })();
    if result.is_err() {
        if let Some(mut worker) = pool.remove(format) {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
    }
    result
}

pub fn apply_scheme(source: &str, scheme: &str) -> Result<String, String> {
    if scheme != "dark" {
        return Ok(source.to_owned());
    }
    let marker = "@startuml";
    let Some(position) = source.find(marker) else {
        return Err("PlantUML 源码必须包含 @startuml".into());
    };
    let insert_at = position + marker.len();
    Ok(format!(
        "{}\n!theme cyborg{}",
        &source[..insert_at],
        &source[insert_at..]
    ))
}

pub fn warm_up(app: &tauri::AppHandle) -> Result<(), String> {
    let _java = crate::resources::lease("java")?;
    let _jar = crate::resources::lease("plantuml")?;
    let paths = resolve_bundled_paths(app)?;
    {
        let mut pool = workers()
            .lock()
            .map_err(|_| "PlantUML 渲染器状态异常".to_string())?;
        if !pool.contains_key("svg") {
            pool.insert("svg".into(), spawn_worker(&paths, "svg")?);
        }
    }
    render_with_worker(&paths, "@startuml\n@enduml", "svg").map(|_| ())
}

/// Resource mutations call this only after excluding active rendering leases.
pub fn stop_idle_workers() -> Result<(), String> {
    workers().lock().map_err(|_| "PlantUML renderer state is unavailable".to_string())?.clear();
    Ok(())
}

fn resolve_bundled_paths(app: &tauri::AppHandle) -> Result<PlantUmlPaths, String> {
    Ok(PlantUmlPaths {
        java: crate::resources::resolve(app, "java")?.0,
        jar: crate::resources::resolve(app, "plantuml")?.0,
    })
}

pub fn render(
    paths: &PlantUmlPaths,
    source: &str,
    scheme: &str,
    format: &str,
) -> Result<Vec<u8>, String> {
    if !matches!(format, "svg" | "png") {
        return Err("PlantUML 仅支持 SVG 或 PNG 导出".into());
    }
    if source.len() > MAX_SOURCE_BYTES {
        return Err("PlantUML 源码超过 2 MB 限制".into());
    }
    let source = apply_scheme(source, scheme)?;
    render_with_worker(paths, &source, format)
}

#[tauri::command]
pub fn render_plantuml(
    app: tauri::AppHandle,
    source: String,
    scheme: String,
    format: String,
) -> Result<Vec<u8>, String> {
    let _java = crate::resources::lease("java")?;
    let _jar = crate::resources::lease("plantuml")?;
    if !matches!(scheme.as_str(), "light" | "dark") {
        return Err("PlantUML 主题无效".into());
    }
    render(&resolve_bundled_paths(&app)?, &source, &scheme, &format)
}

#[cfg(test)]
mod resource_tests {
    use super::*;
    #[test]
    fn consecutive_svg_renders_reuse_the_process_and_idle_workers_can_stop() {
        let paths = bundled_paths(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
        if !paths.java.is_file() || !paths.jar.is_file() { return; }
        render(&paths, "@startuml\nAlice -> Bob\n@enduml", "light", "svg").unwrap();
        let first = workers().lock().unwrap().get("svg").unwrap().child.id();
        render(&paths, "@startuml\nBob -> Alice\n@enduml", "light", "svg").unwrap();
        let second = workers().lock().unwrap().get("svg").unwrap().child.id();
        assert_eq!(first, second);
        // Active operations, not an idle JVM, own the resource leases.
        let java = crate::resources::lease("java").unwrap();
        drop(java);
        stop_idle_workers().unwrap();
        assert!(workers().lock().unwrap().is_empty());
    }
}
