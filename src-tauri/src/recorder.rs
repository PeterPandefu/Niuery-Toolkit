use image::{imageops, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static NEXT_GIF_EXPORT_ID: AtomicU64 = AtomicU64::new(0);
static GIF_EXPORT_REPLACE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTarget {
    pub mode: String,
    pub monitor_id: Option<String>,
    pub window_id: Option<u32>,
    pub rect: Option<CaptureRect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioSettings {
    pub microphone: bool,
    pub system: bool,
    pub microphone_id: Option<String>,
    pub system_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSettings {
    pub fps: u32,
    pub quality: String,
    pub countdown_sec: u32,
    pub cursor_highlight: bool,
    pub audio: RecordingAudioSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub monitor_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSession {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingArtifact {
    pub path: String,
    pub duration_ms: u64,
    /// 用户请求的最高采样帧率。实际帧率受屏幕采集和编码吞吐限制。
    pub requested_fps: u32,
    pub fps: u32,
    /// 实际传给编码器的质量档位，便于在预览和日志中排查成片质量。
    pub quality: String,
    /// 实际采用的采集后端，用于诊断帧率与兼容性。
    pub capture_backend: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub format: String,
    pub size_bytes: u64,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifEditArtifact {
    pub path: String,
    pub size_bytes: u64,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub fps: Option<u32>,
    pub max_width: Option<u32>,
    pub loop_count: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatusEvent {
    session_id: String,
    status: String,
    elapsed_ms: u64,
    fps: u32,
    dropped_frames: u64,
    error: Option<String>,
    artifact: Option<RecordingArtifact>,
}

struct ActiveRecording {
    id: String,
    stop_requested: Arc<AtomicBool>,
    pause_requested: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    elapsed_ms: Arc<AtomicU64>,
    finished: Arc<Mutex<Option<Result<RecordingArtifact, String>>>>,
}

pub struct RecorderState {
    active: Mutex<Option<ActiveRecording>>,
    artifacts: Mutex<HashMap<String, RecordingArtifact>>,
}

pub fn active_session_id(app: &AppHandle) -> Option<String> {
    app.state::<RecorderState>()
        .active
        .lock()
        .ok()
        .and_then(|active| active.as_ref().map(|item| item.id.clone()))
}

impl Default for RecorderState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            artifacts: Mutex::new(HashMap::new()),
        }
    }
}

pub fn clamp_capture_rect(
    rect: CaptureRect,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> CaptureRect {
    let right = monitor_x.saturating_add(monitor_width as i32);
    let bottom = monitor_y.saturating_add(monitor_height as i32);
    let x = rect.x.clamp(monitor_x, right.saturating_sub(1));
    let y = rect.y.clamp(monitor_y, bottom.saturating_sub(1));
    let width = rect.width.max(1).min((right - x).max(1) as u32);
    let height = rect.height.max(1).min((bottom - y).max(1) as u32);
    CaptureRect {
        x,
        y,
        width,
        height,
    }
}

pub fn recording_elapsed_ms(
    started_at_ms: u64,
    now_ms: u64,
    paused_since_ms: Option<u64>,
    paused_total_ms: u64,
) -> u64 {
    let current_pause_ms = paused_since_ms
        .map(|paused_at| now_ms.saturating_sub(paused_at))
        .unwrap_or(0);
    now_ms
        .saturating_sub(started_at_ms)
        .saturating_sub(paused_total_ms.saturating_add(current_pause_ms))
}

/// 录制循环的帧调度状态。
///
/// FFmpeg 使用帧实际到达管道的时间戳并以可变帧率编码；此处只负责在暂停或停止
/// 已经发生时丢弃刚完成捕获的帧，绝不进行追帧写入。
pub struct RecordingFrameScheduler {
    written_frames: u64,
}

impl RecordingFrameScheduler {
    pub fn new() -> Self {
        Self {
            written_frames: 0,
        }
    }

    pub fn should_write_captured_frame(&self, stop_requested: bool, pause_requested: bool) -> bool {
        if stop_requested || pause_requested {
            return false;
        }
        true
    }

    pub fn record_written_frame(&mut self) {
        self.written_frames = self.written_frames.saturating_add(1);
    }

    pub fn written_frames(&self) -> u64 {
        self.written_frames
    }

    pub fn actual_fps(&self, elapsed_ms: u64) -> u32 {
        if elapsed_ms == 0 {
            return 0;
        }
        self.written_frames
            .saturating_mul(1_000)
            .checked_div(elapsed_ms)
            .unwrap_or(0) as u32
    }
}

pub fn build_ffmpeg_args(
    target: &CaptureTarget,
    settings: &RecordingSettings,
    width: u32,
    height: u32,
    output: &str,
) -> Vec<String> {
    build_ffmpeg_args_for_encoder(target, settings, width, height, output, "libx264")
}

pub fn build_ffmpeg_args_for_encoder(
    _target: &CaptureTarget,
    settings: &RecordingSettings,
    width: u32,
    height: u32,
    output: &str,
    encoder: &str,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        // 以每帧实际到达 stdin 的时间生成 PTS，覆盖 rawvideo 的名义帧率推导。
        "-use_wallclock_as_timestamps".to_string(),
        "1".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-video_size".to_string(),
        format!("{}x{}", width, height),
        "-framerate".to_string(),
        settings.fps.clamp(1, 60).to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
    ];
    append_encoding_args(&mut args, settings, output, encoder);
    args
}

fn append_encoding_args(
    args: &mut Vec<String>,
    settings: &RecordingSettings,
    output: &str,
    encoder: &str,
) {
    let crf = match settings.quality.as_str() {
        "high" => "18",
        "small" => "28",
        _ => "22",
    };
    let mut audio_inputs = 0;
    if settings.audio.microphone {
        if let Some(id) = settings
            .audio
            .microphone_id
            .as_ref()
            .filter(|id| !id.trim().is_empty())
        {
            args.extend([
                "-f".to_string(),
                "dshow".to_string(),
                "-i".to_string(),
                format!("audio={id}"),
            ]);
            audio_inputs += 1;
        }
    }
    if settings.audio.system {
        if let Some(id) = settings
            .audio
            .system_id
            .as_ref()
            .filter(|id| !id.trim().is_empty())
        {
            args.extend([
                "-f".to_string(),
                "wasapi".to_string(),
                "-i".to_string(),
                id.to_string(),
            ]);
            audio_inputs += 1;
        }
    }
    args.extend(["-c:v".to_string(), encoder.to_string()]);
    if encoder == "libx264" {
        args.extend([
            "-crf".to_string(),
            crf.to_string(),
            "-preset".to_string(),
            "veryfast".to_string(),
        ]);
    } else if encoder == "h264_mf" {
        let bitrate = match settings.quality.as_str() {
            "high" => "16M",
            "small" => "3M",
            _ => "8M",
        };
        args.extend(["-b:v".to_string(), bitrate.to_string()]);
    } else {
        let quality = match settings.quality.as_str() {
            "high" => "2",
            "small" => "8",
            _ => "5",
        };
        args.extend(["-q:v".to_string(), quality.to_string()]);
    }
    args.extend([
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        // 不能强制补帧或丢帧，保留输入 PTS 才能反映完整捕获/绘制/写入吞吐。
        "-fps_mode".to_string(),
        "vfr".to_string(),
    ]);
    if audio_inputs == 1 {
        args.extend([
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            "1:a:0?".to_string(),
        ]);
    } else if audio_inputs == 2 {
        args.extend([
            "-filter_complex".to_string(),
            "[1:a][2:a]amix=inputs=2:duration=longest[aout]".to_string(),
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            "[aout]".to_string(),
        ]);
    }
    if audio_inputs > 0 {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "128k".to_string(),
            // 音频设备是无限实时源；视频 stdin EOF 时必须结束该录制片段，
            // 否则暂停/停止会一直等待 dshow 或 wasapi 输入。
            "-shortest".to_string(),
        ]);
    }
    args.push(output.to_string());
}

/// 构建 FFmpeg 原生 GDI 屏幕采集命令。采集直接发生在 FFmpeg 中，避免每帧把
/// 整张 RGBA 图像复制到 Rust 再通过 stdin 写入造成的吞吐瓶颈。
pub fn build_gdigrab_ffmpeg_args(
    settings: &RecordingSettings,
    rect: &CaptureRect,
    output: &str,
    encoder: &str,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-framerate".to_string(),
        settings.fps.clamp(1, 60).to_string(),
        "-draw_mouse".to_string(),
        if settings.cursor_highlight { "1" } else { "0" }.to_string(),
        "-offset_x".to_string(),
        rect.x.to_string(),
        "-offset_y".to_string(),
        rect.y.to_string(),
        "-video_size".to_string(),
        format!("{}x{}", rect.width, rect.height),
        "-i".to_string(),
        "desktop".to_string(),
    ];
    append_encoding_args(&mut args, settings, output, encoder);
    args
}

#[tauri::command]
pub fn list_capture_monitors() -> Result<Vec<MonitorInfo>, String> {
    xcap::Monitor::all()
        .map_err(|error| format!("无法读取显示器: {error}"))?
        .iter()
        .map(|monitor| {
            Ok(MonitorInfo {
                id: monitor.id().to_string(),
                name: monitor.name().to_string(),
                x: monitor.x(),
                y: monitor.y(),
                width: monitor.width(),
                height: monitor.height(),
                scale_factor: monitor.scale_factor(),
                primary: monitor.is_primary(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn list_capture_windows() -> Result<Vec<WindowInfo>, String> {
    let current_process = std::process::id();
    let mut result: Vec<_> = xcap::Window::all()
        .map_err(|error| format!("无法读取窗口: {error}"))?
        .into_iter()
        .filter(|window| {
            !window.is_minimized()
                && window.width() > 32
                && window.height() > 32
                && !window.title().trim().is_empty()
                && window.process_id() != current_process
        })
        .map(|window| WindowInfo {
            id: window.id(),
            title: window.title().trim().to_string(),
            app_name: window.app_name().trim().to_string(),
            x: window.x(),
            y: window.y(),
            width: window.width(),
            height: window.height(),
            monitor_id: Some(window.current_monitor().id().to_string()),
        })
        .collect();
    result.sort_by(|left, right| {
        left.app_name
            .cmp(&right.app_name)
            .then(left.title.cmp(&right.title))
    });
    Ok(result)
}

#[tauri::command]
pub fn list_audio_sources(app: AppHandle) -> Vec<AudioSource> {
    let Ok(ffmpeg) = find_ffmpeg(&app) else {
        return Vec::new();
    };
    let mut sources = vec![AudioSource {
        id: "default".to_string(),
        name: "系统声音（默认输出设备）".to_string(),
        kind: "system".to_string(),
    }];
    let output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let Ok(output) = output else {
        return sources;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        let Some(start) = line.find('"') else {
            continue;
        };
        let remaining = &line[start + 1..];
        let Some(end) = remaining.find('"') else {
            continue;
        };
        if !line.to_ascii_lowercase().contains("audio") {
            continue;
        }
        let name = remaining[..end].trim();
        if !name.is_empty() {
            sources.push(AudioSource {
                id: name.to_string(),
                name: name.to_string(),
                kind: "microphone".to_string(),
            });
        }
    }
    sources
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    target: CaptureTarget,
    mut settings: RecordingSettings,
) -> Result<RecordingSession, String> {
    if !cfg!(target_os = "windows") {
        return Err("录屏目前仅支持 Windows".to_string());
    }
    let (width, height) = target_dimensions(&target)?;
    let ffmpeg = find_ffmpeg(&app)?;
    // 在共享入口锁内检查其他捕获会话并占用录屏状态，防止界面命令绕过快捷键保护。
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let _capture_guard = guard_state.lock()?;
    if crate::screenshot::is_screenshot_session_active(&app)
        || app.get_webview_window("longshot-panel").is_some()
    {
        return Err("截图或长截图正在进行，暂时无法开始录屏".to_string());
    }
    let state = app.state::<RecorderState>();
    let mut active = state
        .active
        .lock()
        .map_err(|_| "录屏状态不可用".to_string())?;
    if active.is_some() {
        return Err("已有录制任务正在进行".to_string());
    }

    // 将前端值规范化一次，再把同一份设置交给采样节奏和 FFmpeg，避免两端观察到
    // 不同的帧率或质量档位。
    settings.fps = settings.fps.clamp(1, 60);
    settings.quality = match settings.quality.as_str() {
        "high" | "small" => settings.quality,
        _ => "balanced".to_string(),
    };
    let id = format!("recording-{}", now_millis());
    let path = recording_cache_dir(&app)?.join(format!("{id}.mp4"));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let pause_requested = Arc::new(AtomicBool::new(false));
    let cancelled = Arc::new(AtomicBool::new(false));
    let elapsed_ms = Arc::new(AtomicU64::new(0));
    let finished = Arc::new(Mutex::new(None));
    let thread_stop = Arc::clone(&stop_requested);
    let thread_pause = Arc::clone(&pause_requested);
    let thread_cancelled = Arc::clone(&cancelled);
    let thread_elapsed_ms = Arc::clone(&elapsed_ms);
    let thread_finished = Arc::clone(&finished);
    let thread_app = app.clone();
    let thread_id = id.clone();
    let fps = settings.fps;
    std::thread::spawn(move || {
        let result = capture_loop(
            &thread_app,
            &thread_id,
            &ffmpeg,
            target,
            settings,
            path,
            width,
            height,
            fps,
            thread_stop,
            thread_pause,
            thread_cancelled,
            thread_elapsed_ms,
        );
        if let Err(error) = &result {
            let _ = thread_app.emit(
                "recording-status",
                RecordingStatusEvent {
                    session_id: thread_id.clone(),
                    status: "error".to_string(),
                    elapsed_ms: 0,
                    fps,
                    dropped_frames: 0,
                    error: Some(error.clone()),
                    artifact: None,
                },
            );
        }
        if let Ok(mut slot) = thread_finished.lock() {
            *slot = Some(result);
        }
    });
    *active = Some(ActiveRecording {
        id: id.clone(),
        stop_requested,
        pause_requested,
        cancelled,
        elapsed_ms,
        finished,
    });
    drop(active);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let session = RecordingSession {
        id,
        width,
        height,
        started_at: now_millis(),
    };
    let _ = app.emit(
        "recording-status",
        RecordingStatusEvent {
            session_id: session.id.clone(),
            status: "recording".to_string(),
            elapsed_ms: 0,
            fps,
            dropped_frames: 0,
            error: None,
            artifact: None,
        },
    );
    Ok(session)
}

#[tauri::command]
pub fn pause_recording(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let active = state
        .active
        .lock()
        .map_err(|_| "录屏状态不可用".to_string())?;
    let recording = active
        .as_ref()
        .filter(|item| item.id == session_id)
        .ok_or_else(|| "未找到录制任务".to_string())?;
    recording.pause_requested.store(true, Ordering::Release);
    let _ = app.emit(
        "recording-status",
        RecordingStatusEvent {
            session_id,
            status: "paused".to_string(),
            elapsed_ms: recording.elapsed_ms.load(Ordering::Acquire),
            fps: 0,
            dropped_frames: 0,
            error: None,
            artifact: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn resume_recording(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let active = state
        .active
        .lock()
        .map_err(|_| "录屏状态不可用".to_string())?;
    let recording = active
        .as_ref()
        .filter(|item| item.id == session_id)
        .ok_or_else(|| "未找到录制任务".to_string())?;
    recording.pause_requested.store(false, Ordering::Release);
    let _ = app.emit(
        "recording-status",
        RecordingStatusEvent {
            session_id,
            status: "recording".to_string(),
            elapsed_ms: recording.elapsed_ms.load(Ordering::Acquire),
            fps: 0,
            dropped_frames: 0,
            error: None,
            artifact: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    session_id: String,
) -> Result<RecordingArtifact, String> {
    finish_recording(app, session_id, false).await
}

#[tauri::command]
pub async fn cancel_recording(app: AppHandle, session_id: String) -> Result<(), String> {
    let artifact = finish_recording(app, session_id, true).await?;
    let _ = std::fs::remove_file(artifact.path);
    Ok(())
}

#[tauri::command]
pub async fn export_recording(
    app: AppHandle,
    session_id: String,
    format: String,
    options: ExportOptions,
    output_path: Option<String>,
) -> Result<ExportResult, String> {
    let state = app.state::<RecorderState>();
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| "录制结果不可用".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "录制预览已过期，请重新录制".to_string())?;
    let destination = match output_path {
        Some(path) => PathBuf::from(path),
        None => choose_export_path(&format)?,
    };
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("无法创建导出目录: {error}"))?;
    }
    let warning = match format.as_str() {
        "mp4" => {
            std::fs::copy(&artifact.path, &destination)
                .map_err(|error| format!("导出 MP4 失败: {error}"))?;
            None
        }
        "gif" => {
            export_gif(&app, &artifact.path, &destination, &options)?
        }
        _ => return Err("仅支持导出 MP4 或 GIF".to_string()),
    };
    let size_bytes = std::fs::metadata(&destination)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(ExportResult {
        path: destination.to_string_lossy().to_string(),
        format,
        size_bytes,
        warning,
    })
}

#[tauri::command]
pub fn get_recording_preview(app: AppHandle, session_id: String) -> Result<Response, String> {
    let state = app.state::<RecorderState>();
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| "录制结果不可用".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "录制预览已过期，请重新录制".to_string())?;
    let bytes =
        std::fs::read(&artifact.path).map_err(|error| format!("无法读取录制预览: {error}"))?;
    Ok(Response::new(bytes))
}

/// 在系统文件管理器中定位录制缓存文件。只允许按会话 ID 查找，避免前端传入任意路径。
#[tauri::command]
pub fn reveal_recording_in_folder(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| "录制结果不可用".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "录制预览已过期，请重新录制".to_string())?;
    if !Path::new(&artifact.path).is_file() {
        return Err("录制缓存文件不存在，可能已被清理".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", artifact.path))
            .spawn()
            .map_err(|error| format!("无法打开录制文件所在目录: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = artifact;
        Err("定位录制文件目前仅支持 Windows".to_string())
    }
}

#[tauri::command]
pub async fn prepare_gif_editor(
    app: AppHandle,
    session_id: String,
) -> Result<GifEditArtifact, String> {
    let state = app.state::<RecorderState>();
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| "录制结果不可用".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "录制预览已过期，请重新录制".to_string())?;
    let output = recording_cache_dir(&app)?.join(format!("{}-edit.gif", session_id));
    let warning = export_gif(
        &app,
        &artifact.path,
        &output,
        &ExportOptions {
            fps: Some(12),
            max_width: Some(800),
            loop_count: Some(0),
        },
    )?;
    let size_bytes = std::fs::metadata(&output)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(GifEditArtifact {
        path: output.to_string_lossy().to_string(),
        size_bytes,
        warning,
    })
}

async fn finish_recording(
    app: AppHandle,
    session_id: String,
    cancelled: bool,
) -> Result<RecordingArtifact, String> {
    let state = app.state::<RecorderState>();
    let active = {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "录屏状态不可用".to_string())?;
        let recording = active.take().ok_or_else(|| "未找到录制任务".to_string())?;
        if recording.id != session_id {
            *active = Some(recording);
            return Err("录制会话不匹配".to_string());
        }
        recording
    };
    active.cancelled.store(cancelled, Ordering::Release);
    active.stop_requested.store(true, Ordering::Release);
    for _ in 0..300 {
        if let Some(result) = active
            .finished
            .lock()
            .map_err(|_| "录屏状态不可用".to_string())?
            .take()
        {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let artifact = result?;
            if !cancelled {
                state
                    .artifacts
                    .lock()
                    .map_err(|_| "录制结果不可用".to_string())?
                    .insert(session_id.clone(), artifact.clone());
                let _ = app.emit(
                    "recording-status",
                RecordingStatusEvent {
                    session_id: session_id.clone(),
                    status: "stopped".to_string(),
                    elapsed_ms: artifact.duration_ms,
                    fps: artifact.fps,
                        dropped_frames: 0,
                        error: None,
                        artifact: Some(artifact.clone()),
                    },
                );
            }
            return Ok(artifact);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("停止录制超时，请稍后重试".to_string())
}

enum EncoderInput {
    RawFrames(ChildStdin),
    NativeCaptureControl(ChildStdin),
}

struct EncoderSegment {
    child: Child,
    input: EncoderInput,
    path: PathBuf,
    has_frames: bool,
    capture_backend: &'static str,
}

const CURSOR_HIGHLIGHT_WINDOW: &str = "recording-cursor-highlight";
const CURSOR_HIGHLIGHT_SIZE: i32 = 56;

struct CursorHighlightOverlay {
    stop_requested: Arc<AtomicBool>,
    window: WebviewWindow,
    follow_thread: Option<std::thread::JoinHandle<()>>,
}

fn stop_and_join_cursor_follow_thread(
    stop_requested: &AtomicBool,
    follow_thread: &mut Option<std::thread::JoinHandle<()>>,
) {
    stop_requested.store(true, Ordering::Release);
    if let Some(thread) = follow_thread.take() {
        let _ = thread.join();
    }
}

impl Drop for CursorHighlightOverlay {
    fn drop(&mut self) {
        stop_and_join_cursor_follow_thread(&self.stop_requested, &mut self.follow_thread);
        let _ = self.window.hide();
    }
}

impl CursorHighlightOverlay {
    fn hide(&self) {
        let _ = self.window.hide();
    }

    fn show(&self) {
        let _ = self.window.show();
    }
}

fn start_cursor_highlight_overlay(app: &AppHandle) -> Result<CursorHighlightOverlay, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let window = if let Some(window) = app.get_webview_window(CURSOR_HIGHLIGHT_WINDOW) {
            window
        } else {
            WebviewWindowBuilder::new(
                app,
                CURSOR_HIGHLIGHT_WINDOW,
                WebviewUrl::App("index.html#/recording-cursor-highlight".into()),
            )
            .title("录制光标高亮")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .inner_size(CURSOR_HIGHLIGHT_SIZE as f64, CURSOR_HIGHLIGHT_SIZE as f64)
            .visible(false)
            .build()
            .map_err(|error| format!("无法创建录制光标高亮层: {error}"))?
        };
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| format!("无法设置录制光标高亮层穿透: {error}"))?;
        window
            .show()
            .map_err(|error| format!("无法显示录制光标高亮层: {error}"))?;
        let stop_requested = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop_requested);
        let thread_window = window.clone();
        let follow_thread = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                let mut point = POINT::default();
                if unsafe { GetCursorPos(&mut point) }.is_ok() {
                    let _ = thread_window.set_position(Position::Physical(PhysicalPosition::new(
                        point.x - CURSOR_HIGHLIGHT_SIZE / 2,
                        point.y - CURSOR_HIGHLIGHT_SIZE / 2,
                    )));
                }
                std::thread::sleep(Duration::from_millis(16));
            }
            let _ = thread_window.hide();
        });
        Ok(CursorHighlightOverlay {
            stop_requested,
            window,
            follow_thread: Some(follow_thread),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("录制光标高亮目前仅支持 Windows".to_string())
    }
}

fn start_encoder_after_highlight<T, U>(
    start_highlight: impl FnOnce() -> Result<Option<T>, String>,
    start_encoder: impl FnOnce() -> Result<U, String>,
) -> Result<(Option<T>, U), String> {
    let highlight = start_highlight()?;
    let encoder = start_encoder()?;
    Ok((highlight, encoder))
}

impl EncoderSegment {
    fn uses_native_capture(&self) -> bool {
        matches!(self.input, EncoderInput::NativeCaptureControl(_))
    }

    fn write_frame(&mut self, frame: &RgbaImage) -> Result<(), String> {
        match &mut self.input {
            EncoderInput::RawFrames(stdin) => stdin
                .write_all(frame.as_raw())
                .map_err(|error| format!("写入视频帧失败: {error}")),
            EncoderInput::NativeCaptureControl(_) => Ok(()),
        }
    }
}

fn gdigrab_capture_rect(target: &CaptureTarget) -> Result<Option<CaptureRect>, String> {
    match target.mode.as_str() {
        "monitor" => {
            let monitor = find_monitor(target.monitor_id.as_deref())?;
            Ok(Some(CaptureRect {
                x: monitor.x(),
                y: monitor.y(),
                width: monitor.width(),
                height: monitor.height(),
            }))
        }
        "region" => {
            let monitor = find_monitor(target.monitor_id.as_deref())?;
            let rect = target
                .rect
                .clone()
                .ok_or_else(|| "区域录制缺少框选坐标".to_string())?;
            Ok(Some(clamp_capture_rect(
                rect,
                monitor.x(),
                monitor.y(),
                monitor.width(),
                monitor.height(),
            )))
        }
        // gdigrab 的窗口标题捕获会受标题变化和 UWP/硬件加速窗口限制；窗口模式
        // 暂保留 xcap 路径，以维持现有“按窗口 ID”契约。
        "window" => Ok(None),
        _ => Err("未知的录制模式".to_string()),
    }
}

fn start_encoder_segment(
    ffmpeg: &Path,
    target: &CaptureTarget,
    settings: &RecordingSettings,
    width: u32,
    height: u32,
    path: PathBuf,
) -> Result<EncoderSegment, String> {
    let encoder = select_video_encoder(ffmpeg);
    let output = path.to_string_lossy().to_string();
    let native_rect = gdigrab_capture_rect(target)?;
    let (args, native_capture, capture_backend) = if let Some(rect) = native_rect {
        (
            build_gdigrab_ffmpeg_args(settings, &rect, &output, encoder),
            "native",
            "gdigrab",
        )
    } else {
        (
            build_ffmpeg_args_for_encoder(target, settings, width, height, &output, encoder),
            "raw",
            "xcap",
        )
    };
    let mut child = Command::new(ffmpeg)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 FFmpeg 视频输入".to_string())?;
    let input = if native_capture == "native" {
        EncoderInput::NativeCaptureControl(stdin)
    } else {
        EncoderInput::RawFrames(stdin)
    };
    Ok(EncoderSegment {
        child,
        input,
        path,
        // gdigrab 在 FFmpeg 进程内持续采样，不会由 Rust 逐帧标记。
        has_frames: native_capture == "native",
        capture_backend,
    })
}

fn finish_encoder_segment(mut segment: EncoderSegment, cancelled: bool) -> Result<Option<PathBuf>, String> {
    match &mut segment.input {
        EncoderInput::RawFrames(_) => {}
        EncoderInput::NativeCaptureControl(stdin) => {
            // FFmpeg 的交互控制输入使用 q 结束并写入 MP4 尾部，不能直接 kill 进程。
            let _ = stdin.write_all(b"q\n");
        }
    }
    drop(segment.input);
    if !segment.has_frames {
        let _ = segment.child.kill();
        let _ = segment.child.wait();
        let _ = std::fs::remove_file(&segment.path);
        return Ok(None);
    }
    let status = segment
        .child
        .wait()
        .map_err(|error| format!("FFmpeg 无法结束: {error}"))?;
    if !status.success() && !cancelled {
        return Err("FFmpeg 编码失败，请确认打包的 FFmpeg 支持可用的视频编码器".to_string());
    }
    Ok(Some(segment.path))
}

pub fn concat_recording_segments(ffmpeg: &Path, segments: &[PathBuf], output: &Path) -> Result<(), String> {
    if segments.len() == 1 {
        std::fs::rename(&segments[0], output).map_err(|error| format!("整理录制片段失败: {error}"))?;
        return Ok(());
    }
    let list_path = output.with_extension("concat.txt");
    let list = segments
        .iter()
        .map(|path| format!("file '{}'", path.to_string_lossy().replace('\\', "/").replace('\'', "'\\\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&list_path, list).map_err(|error| format!("写入录制片段清单失败: {error}"))?;
    let status = Command::new(ffmpeg)
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_path.to_string_lossy(),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            &output.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("无法拼接录制片段: {error}"))?;
    let _ = std::fs::remove_file(&list_path);
    if !status.success() {
        return Err("拼接录制片段失败".to_string());
    }
    for segment in segments {
        let _ = std::fs::remove_file(segment);
    }
    Ok(())
}

pub fn parse_ffmpeg_progress_fps(progress: &str) -> Option<u32> {
    let mut frames = None;
    let mut duration_us = None;
    for line in progress.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "frame" => frames = value.parse::<u64>().ok(),
            "out_time_us" => duration_us = value.parse::<u64>().ok(),
            _ => {}
        }
    }
    let frames = frames?;
    let duration_us = duration_us?.max(1);
    Some(((frames as f64 * 1_000_000.0) / duration_us as f64).round() as u32)
}

fn probe_recording_fps(ffmpeg: &Path, output: &Path) -> Option<u32> {
    let details = Command::new(ffmpeg)
        .args([
            "-v",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
            "-i",
        ])
        .arg(output)
        .args(["-map", "0:v:0", "-f", "null", "-"])
        .output()
        .ok()?;
    parse_ffmpeg_progress_fps(&String::from_utf8_lossy(&details.stdout))
}

#[allow(clippy::too_many_arguments)]
fn capture_loop(
    app: &AppHandle,
    session_id: &str,
    ffmpeg: &Path,
    target: CaptureTarget,
    settings: RecordingSettings,
    output: PathBuf,
    width: u32,
    height: u32,
    fps: u32,
    stop_requested: Arc<AtomicBool>,
    pause_requested: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    active_elapsed_ms: Arc<AtomicU64>,
) -> Result<RecordingArtifact, String> {
    let started = Instant::now();
    let mut scheduler = RecordingFrameScheduler::new();
    let frame_duration = Duration::from_secs_f64(1.0 / fps.max(1) as f64);
    let mut next_frame = Instant::now();
    let mut dropped_frames = 0u64;
    let mut paused_since_ms = None;
    let mut paused_total_ms = 0u64;
    let mut last_status_emit_ms = 0u64;
    let mut segments = Vec::new();
    let mut segment_index = 0u64;
    let mut capture_backend = "xcap";
    // 先确保高亮层可用，再启动 gdigrab。否则高亮层创建失败时不会遗留已经开始
    // 采集的 FFmpeg 子进程。
    let uses_native_capture = gdigrab_capture_rect(&target)?.is_some();
    let (cursor_highlight, initial_segment) = start_encoder_after_highlight(
        || {
            if settings.cursor_highlight && uses_native_capture {
                Ok(Some(start_cursor_highlight_overlay(app)?))
            } else {
                Ok(None)
            }
        },
        || {
            start_encoder_segment(
                ffmpeg,
                &target,
                &settings,
                width,
                height,
                output.with_file_name(format!(
                    "{}-segment-{segment_index}.mp4",
                    output.file_stem().and_then(|name| name.to_str()).unwrap_or("recording")
                )),
            )
        },
    )?;
    let mut segment = Some(initial_segment);
    if let Some(active_segment) = segment.as_ref() {
        capture_backend = active_segment.capture_backend;
    }
    while !stop_requested.load(Ordering::Acquire) {
        let wall_elapsed_ms = started.elapsed().as_millis() as u64;
        if pause_requested.load(Ordering::Acquire) {
            if let Some(overlay) = cursor_highlight.as_ref() {
                overlay.hide();
            }
            if let Some(active_segment) = segment.take() {
                if let Some(path) = finish_encoder_segment(active_segment, cancelled.load(Ordering::Acquire))? {
                    segments.push(path);
                }
            }
            if paused_since_ms.is_none() {
                paused_since_ms = Some(wall_elapsed_ms);
            }
            active_elapsed_ms.store(
                recording_elapsed_ms(0, wall_elapsed_ms, paused_since_ms, paused_total_ms),
                Ordering::Release,
            );
            std::thread::sleep(Duration::from_millis(60));
            continue;
        }
        if let Some(paused_at_ms) = paused_since_ms.take() {
            paused_total_ms = paused_total_ms.saturating_add(wall_elapsed_ms.saturating_sub(paused_at_ms));
            next_frame = Instant::now();
            if let Some(overlay) = cursor_highlight.as_ref() {
                overlay.show();
            }
        }
        if segment.is_none() {
            segment_index = segment_index.saturating_add(1);
            segment = Some(start_encoder_segment(
                ffmpeg,
                &target,
                &settings,
                width,
                height,
                output.with_file_name(format!(
                    "{}-segment-{segment_index}.mp4",
                    output.file_stem().and_then(|name| name.to_str()).unwrap_or("recording")
                )),
            )?);
            if let Some(active_segment) = segment.as_ref() {
                capture_backend = active_segment.capture_backend;
            }
        }
        if segment
            .as_ref()
            .is_some_and(EncoderSegment::uses_native_capture)
        {
            // 画面直接由 gdigrab 交给 FFmpeg/H.264 硬编。这里只维持会话时钟、状态
            // 上报与暂停/停止响应，避免回退到每帧 RGBA 复制和 stdin 写入。
            let elapsed_ms = recording_elapsed_ms(
                0,
                started.elapsed().as_millis() as u64,
                None,
                paused_total_ms,
            );
            active_elapsed_ms.store(elapsed_ms, Ordering::Release);
            if elapsed_ms.saturating_sub(last_status_emit_ms) >= 1_000 {
                let _ = app.emit(
                    "recording-status",
                    RecordingStatusEvent {
                        session_id: session_id.to_string(),
                        status: "recording".to_string(),
                        elapsed_ms,
                        // 采集帧数由 FFmpeg 管理；结束后再从成片探测真实平均帧率，
                        // 录制中以 0 表示尚未可测，绝不把目标帧率伪报成实际帧率。
                        fps: 0,
                        dropped_frames: 0,
                        error: None,
                        artifact: None,
                    },
                );
                last_status_emit_ms = elapsed_ms;
            }
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }
        let frame_start = Instant::now();
        let frame = capture_target(&target)?;
        let frame = if settings.cursor_highlight {
            draw_cursor_highlight(frame, &target)
        } else {
            frame
        };
        if frame.width() != width || frame.height() != height {
            return Err("录制目标尺寸发生变化，请重新开始录制".to_string());
        }
        let elapsed_ms = recording_elapsed_ms(
            0,
            started.elapsed().as_millis() as u64,
            None,
            paused_total_ms,
        );
        // capture_target 期间暂停或停止时，丢弃刚完成的帧；每次采样至多写一帧。
        if scheduler.should_write_captured_frame(
            stop_requested.load(Ordering::Acquire),
            pause_requested.load(Ordering::Acquire),
        ) {
            let active_segment = segment.as_mut().expect("活动录制片段必须存在");
            active_segment.write_frame(&frame)?;
            active_segment.has_frames = true;
            scheduler.record_written_frame();
        }
        if stop_requested.load(Ordering::Acquire) {
            break;
        }
        if pause_requested.load(Ordering::Acquire) {
            // 下一轮进入暂停分支并冻结录制时长；当前刚捕获的帧已被丢弃。
            continue;
        }
        active_elapsed_ms.store(elapsed_ms, Ordering::Release);
        if elapsed_ms.saturating_sub(last_status_emit_ms) >= 1_000 {
            let actual_fps = scheduler.actual_fps(elapsed_ms);
            let _ = app.emit(
                "recording-status",
                RecordingStatusEvent {
                    session_id: session_id.to_string(),
                    status: "recording".to_string(),
                    elapsed_ms,
                    fps: actual_fps,
                    dropped_frames,
                    error: None,
                    artifact: None,
                },
            );
            last_status_emit_ms = elapsed_ms;
        }
        next_frame += frame_duration;
        let now = Instant::now();
        if now < next_frame {
            std::thread::sleep(next_frame - now);
        } else if now.duration_since(next_frame) > frame_duration {
            dropped_frames += 1;
            next_frame = frame_start + frame_duration;
        }
    }
    let elapsed_ms = recording_elapsed_ms(
        0,
        started.elapsed().as_millis() as u64,
        paused_since_ms,
        paused_total_ms,
    );
    active_elapsed_ms.store(elapsed_ms, Ordering::Release);
    if let Some(active_segment) = segment.take() {
        if let Some(path) = finish_encoder_segment(active_segment, cancelled.load(Ordering::Acquire))? {
            segments.push(path);
        }
    }
    drop(cursor_highlight);
    if segments.is_empty() {
        return Err("录制未产生可用的视频帧".to_string());
    }
    concat_recording_segments(ffmpeg, &segments, &output)?;
    let size_bytes = std::fs::metadata(&output)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let actual_fps = probe_recording_fps(ffmpeg, &output).unwrap_or_else(|| scheduler.actual_fps(elapsed_ms));
    let artifact = RecordingArtifact {
        path: output.to_string_lossy().to_string(),
        duration_ms: elapsed_ms,
        requested_fps: fps,
        fps: actual_fps,
        quality: settings.quality.clone(),
        capture_backend: capture_backend.to_string(),
        width,
        height,
        size_bytes,
    };
    let _ = app.emit(
        "recording-status",
        RecordingStatusEvent {
            session_id: session_id.to_string(),
            status: "stopped".to_string(),
            elapsed_ms: artifact.duration_ms,
            fps: artifact.fps,
            dropped_frames,
            error: None,
            artifact: None,
        },
    );
    Ok(artifact)
}

fn target_dimensions(target: &CaptureTarget) -> Result<(u32, u32), String> {
    match target.mode.as_str() {
        "monitor" | "region" => {
            let monitor = find_monitor(target.monitor_id.as_deref())?;
            if target.mode == "region" {
                let rect = clamp_capture_rect(
                    target
                        .rect
                        .clone()
                        .ok_or_else(|| "区域录制缺少框选坐标".to_string())?,
                    monitor.x(),
                    monitor.y(),
                    monitor.width(),
                    monitor.height(),
                );
                Ok((rect.width, rect.height))
            } else {
                Ok((monitor.width(), monitor.height()))
            }
        }
        "window" => {
            let window = find_window(target.window_id)?;
            Ok((window.width(), window.height()))
        }
        _ => Err("未知的录制模式".to_string()),
    }
}

fn capture_target(target: &CaptureTarget) -> Result<RgbaImage, String> {
    match target.mode.as_str() {
        "monitor" => find_monitor(target.monitor_id.as_deref())?
            .capture_image()
            .map_err(|error| format!("捕获显示器失败: {error}")),
        "region" => {
            let monitor = find_monitor(target.monitor_id.as_deref())?;
            let rect = clamp_capture_rect(
                target
                    .rect
                    .clone()
                    .ok_or_else(|| "区域录制缺少框选坐标".to_string())?,
                monitor.x(),
                monitor.y(),
                monitor.width(),
                monitor.height(),
            );
            let image = monitor
                .capture_image()
                .map_err(|error| format!("捕获显示器失败: {error}"))?;
            Ok(imageops::crop_imm(
                &image,
                (rect.x - monitor.x()) as u32,
                (rect.y - monitor.y()) as u32,
                rect.width,
                rect.height,
            )
            .to_image())
        }
        "window" => find_window(target.window_id)?
            .capture_image()
            .map_err(|error| format!("捕获窗口失败: {error}")),
        _ => Err("未知的录制模式".to_string()),
    }
}

fn find_monitor(id: Option<&str>) -> Result<xcap::Monitor, String> {
    let id = id.ok_or_else(|| "缺少显示器编号".to_string())?;
    xcap::Monitor::all()
        .map_err(|error| format!("无法读取显示器: {error}"))?
        .into_iter()
        .find(|monitor| monitor.id().to_string() == id)
        .ok_or_else(|| "未找到显示器".to_string())
}

fn find_window(id: Option<u32>) -> Result<xcap::Window, String> {
    let id = id.ok_or_else(|| "缺少窗口编号".to_string())?;
    xcap::Window::all()
        .map_err(|error| format!("无法读取窗口: {error}"))?
        .into_iter()
        .find(|window| window.id() == id)
        .ok_or_else(|| "未找到窗口".to_string())
}

fn draw_cursor_highlight(mut image: RgbaImage, target: &CaptureTarget) -> RgbaImage {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_ok() {
            let (origin_x, origin_y) = match target.mode.as_str() {
                "region" => target
                    .rect
                    .as_ref()
                    .map(|rect| (rect.x, rect.y))
                    .unwrap_or((0, 0)),
                "monitor" => find_monitor(target.monitor_id.as_deref())
                    .map(|monitor| (monitor.x(), monitor.y()))
                    .unwrap_or((0, 0)),
                "window" => find_window(target.window_id)
                    .map(|window| (window.x(), window.y()))
                    .unwrap_or((0, 0)),
                _ => (0, 0),
            };
            let cx = point.x - origin_x;
            let cy = point.y - origin_y;
            for y in (cy - 14)..=(cy + 14) {
                for x in (cx - 14)..=(cx + 14) {
                    if x >= 0 && y >= 0 && x < image.width() as i32 && y < image.height() as i32 {
                        let dx = x - cx;
                        let dy = y - cy;
                        if dx * dx + dy * dy <= 196 {
                            let pixel = image.get_pixel_mut(x as u32, y as u32);
                            *pixel = image::Rgba([255, 70, 70, 180]);
                        }
                    }
                }
            }
        }
    }
    image
}

pub fn ffmpeg_resource_candidates(resource_dir: &Path) -> [PathBuf; 2] {
    [
        resource_dir.join("ffmpeg.exe"),
        resource_dir.join("resources").join("ffmpeg.exe"),
    ]
}

fn find_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    let resource = app.path().resource_dir().ok();
    if let Some(path) = resource
        .as_deref()
        .map(ffmpeg_resource_candidates)
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
    {
        return Ok(path);
    }
    if Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("ffmpeg"));
    }
    Err("找不到 FFmpeg。请将 LGPL 版 ffmpeg.exe 放入 src-tauri/resources 后重新打包，或将 FFmpeg 加入系统 PATH。".to_string())
}

fn select_video_encoder(ffmpeg: &Path) -> &'static str {
    let codecs = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .ok()
        .map(|output| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        })
        .unwrap_or_default();
    if codecs.contains("libx264") {
        "libx264"
    } else if codecs.contains("h264_mf") {
        "h264_mf"
    } else {
        "mpeg4"
    }
}

fn recording_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位录制缓存目录: {error}"))?
        .join("recordings");
    std::fs::create_dir_all(&path).map_err(|error| format!("无法创建录制缓存目录: {error}"))?;
    Ok(path)
}

fn default_export_path(format: &str) -> PathBuf {
    let extension = if format == "gif" { "gif" } else { "mp4" };
    let filename = format!("recording-{}.{}", now_millis(), extension);
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|path| path.join("Videos").join(filename.clone()))
        .unwrap_or_else(|| PathBuf::from(filename))
}

fn choose_export_path(format: &str) -> Result<PathBuf, String> {
    let extension = if format == "gif" { "gif" } else { "mp4" };
    let label = if format == "gif" {
        "GIF 动图"
    } else {
        "MP4 视频"
    };
    let default = default_export_path(format);
    let filename = default
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("recording");
    rfd::FileDialog::new()
        .set_directory(default.parent().unwrap_or_else(|| Path::new(".")))
        .set_file_name(filename)
        .add_filter(label, &[extension])
        .save_file()
        .ok_or_else(|| "已取消导出".to_string())
}

fn export_gif(
    app: &AppHandle,
    input: &str,
    output: &Path,
    options: &ExportOptions,
) -> Result<Option<String>, String> {
    let ffmpeg = find_ffmpeg(app)?;
    export_gif_with_ffmpeg(&ffmpeg, Path::new(input), output, options)
}

/// 将 GIF 先写入同目录的临时文件，仅在 FFmpeg 成功且产物非空时替换目标文件。
/// 这样导出失败不会覆盖用户已有文件，也不会留下可被误用的损坏 GIF。
fn export_gif_with_ffmpeg(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    options: &ExportOptions,
) -> Result<Option<String>, String> {
    if !input.is_file() {
        return Err("GIF 导出失败：录制缓存文件不存在或无法访问，请重新录制后再试".to_string());
    }
    let fps = options.fps.unwrap_or(12).clamp(1, 30);
    let max_width = options.max_width.unwrap_or(800).clamp(64, 1920);
    let loop_count = options.loop_count.unwrap_or(0).min(65_535).to_string();
    let filter = format!("fps={fps},scale='min({max_width},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse");
    let temporary = gif_temporary_path(output);
    let command_output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-y",
            "-i",
            input.to_string_lossy().as_ref(),
            "-vf",
            &filter,
            "-loop",
            &loop_count,
            temporary.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|error| format!("无法启动 GIF 导出: {error}"))?;
    if !command_output.status.success() {
        let _ = std::fs::remove_file(&temporary);
        return Err(format_gif_export_error(
            command_output.status.code(),
            &command_output.stderr,
            input,
            output,
            &temporary,
        ));
    }

    let size_bytes = std::fs::metadata(&temporary)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size_bytes == 0 {
        let _ = std::fs::remove_file(&temporary);
        return Err("GIF 导出失败：FFmpeg 未生成有效文件，请检查录制缓存后重试".to_string());
    }

    replace_gif_export(&temporary, output)
}

fn replace_gif_export(temporary: &Path, output: &Path) -> Result<Option<String>, String> {
    // 多次点击导出可能让两个 FFmpeg 几乎同时完成；只串行化最终替换步骤，避免
    // 一个会话把另一个会话刚写入的目标当作“旧文件”进行备份。
    let _guard = GIF_EXPORT_REPLACE_LOCK
        .lock()
        .map_err(|_| "GIF 导出替换状态不可用，请重试".to_string())?;
    replace_gif_export_with(
        temporary,
        output,
        |from, to| std::fs::rename(from, to),
        |path| std::fs::remove_file(path),
    )
}

/// 同目录的三步替换：旧文件先原子移动为备份，再移动临时成品，最后删除备份。
/// 若第二步失败，会立即回滚备份；绝不在新文件就位前删除旧 GIF。
fn replace_gif_export_with(
    temporary: &Path,
    output: &Path,
    mut rename: impl FnMut(&Path, &Path) -> std::io::Result<()>,
    mut remove: impl FnMut(&Path) -> std::io::Result<()>,
) -> Result<Option<String>, String> {
    if !output.exists() {
        return rename(temporary, output).map(|_| None).map_err(|error| {
            let _ = remove(temporary);
            format!("GIF 已生成但无法完成保存: {error}；请确认目标文件夹可写后重试")
        });
    }
    if !output.is_file() {
        let _ = remove(temporary);
        return Err("GIF 已生成但目标路径不是文件，未覆盖任何内容；请选择一个 GIF 文件名后重试".to_string());
    }

    let backup = gif_backup_path(output);
    rename(output, &backup).map_err(|error| {
        let _ = remove(temporary);
        format!("GIF 已生成但无法备份已有目标文件: {error}；请关闭占用该文件的程序后重试")
    })?;

    match rename(temporary, output) {
        Ok(()) => {
            match remove(&backup) {
                Ok(()) => Ok(None),
                Err(error) => Ok(Some(format!(
                    "新 GIF 已导出，但旧备份保留在目标文件同目录（清理失败: {error}）。请关闭占用该备份的程序后手动删除文件名包含 .previous- 的 GIF 文件"
                ))),
            }
        }
        Err(error) => match rename(&backup, output) {
            Ok(()) => {
                let _ = remove(temporary);
                Err(format!("GIF 已生成但无法替换目标文件: {error}；已保留原 GIF，请关闭占用该文件的程序后重试"))
            }
            Err(rollback_error) => Err(format!(
                "GIF 替换失败且无法自动回滚: {error}；原 GIF 与新 GIF 均保留在目标文件同目录，请勿清理后重试（回滚错误: {rollback_error}）"
            )),
        },
    }
}

fn gif_temporary_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("recording");
    let extension = output.extension().and_then(|name| name.to_str()).unwrap_or("gif");
    output.with_file_name(format!(
        ".{stem}.exporting-{}-{}-{:#x}.{extension}",
        std::process::id(),
        NEXT_GIF_EXPORT_ID.fetch_add(1, Ordering::Relaxed),
        now_millis(),
    ))
}

fn gif_backup_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("recording");
    let extension = output.extension().and_then(|name| name.to_str()).unwrap_or("gif");
    output.with_file_name(format!(
        ".{stem}.previous-{}-{}-{:#x}.{extension}",
        std::process::id(),
        NEXT_GIF_EXPORT_ID.fetch_add(1, Ordering::Relaxed),
        now_millis(),
    ))
}

/// FFmpeg 往往只把可操作的失败原因写入 stderr。仅返回末尾的错误摘要，并替换本次
/// 输入、输出和临时文件路径，避免将用户的完整本地路径暴露给前端日志。
fn format_gif_export_error(
    exit_code: Option<i32>,
    stderr: &[u8],
    input: &Path,
    output: &Path,
    temporary: &Path,
) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let mut summary = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("frame="))
        .rev()
        .take(4)
        .collect::<Vec<_>>();
    summary.reverse();
    let mut summary = summary.join("；");
    for (path, replacement) in [
        (input, "录制缓存"),
        (output, "目标 GIF"),
        (temporary, "临时 GIF"),
    ] {
        summary = summary.replace(path.to_string_lossy().as_ref(), replacement);
    }
    if summary.len() > 700 {
        summary.truncate(700);
        summary.push_str("……");
    }
    let code = exit_code
        .map(|value| value.to_string())
        .unwrap_or_else(|| "未知".to_string());
    if summary.is_empty() {
        format!("GIF 导出失败（FFmpeg 退出码 {code}）：未返回诊断信息，请确认录制缓存可播放后重试")
    } else {
        format!("GIF 导出失败（FFmpeg 退出码 {code}）：{summary}。请确认录制缓存可播放后重试")
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn cleanup_stale_recordings(app: &AppHandle) {
    let Ok(directory) = recording_cache_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified
            .elapsed()
            .map(|elapsed| elapsed > Duration::from_secs(24 * 60 * 60))
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        export_gif_with_ffmpeg, replace_gif_export_with, start_encoder_after_highlight,
        stop_and_join_cursor_follow_thread, ExportOptions,
    };
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn does_not_start_encoder_when_required_highlight_cannot_start() {
        let encoder_started = AtomicBool::new(false);
        let result = start_encoder_after_highlight::<(), ()>(
            || Err("高亮层不可用".to_string()),
            || {
                encoder_started.store(true, Ordering::Release);
                Ok(())
            },
        );

        assert_eq!(result.unwrap_err(), "高亮层不可用");
        assert!(!encoder_started.load(Ordering::Acquire));
    }

    #[test]
    fn waits_for_old_cursor_follower_before_a_new_session_can_reuse_the_window() {
        let stop_requested = Arc::new(AtomicBool::new(false));
        let old_thread_finished = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop_requested);
        let thread_finished = Arc::clone(&old_thread_finished);
        let mut follow_thread = Some(std::thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
            // 代表旧跟随线程最后一次 hide；join 返回前它必须已经完成。
            thread_finished.store(true, Ordering::Release);
        }));

        stop_and_join_cursor_follow_thread(&stop_requested, &mut follow_thread);

        assert!(old_thread_finished.load(Ordering::Acquire));
        assert!(follow_thread.is_none());
    }

    #[test]
    fn gif_export_returns_ffmpeg_diagnostics_and_removes_partial_output() {
        let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg.exe");
        let directory = std::env::temp_dir().join(format!(
            "niuery-gif-export-failure-{}-{}",
            std::process::id(),
            super::now_millis(),
        ));
        std::fs::create_dir_all(&directory).expect("应能创建 GIF 导出测试目录");
        let input = directory.join("invalid.mp4");
        let output = directory.join("output.gif");
        std::fs::write(&input, b"not a video").expect("应能写入无效视频样本");

        let error = export_gif_with_ffmpeg(
            &ffmpeg,
            &input,
            &output,
            &ExportOptions {
                fps: Some(12),
                max_width: Some(800),
                loop_count: Some(0),
            },
        )
        .expect_err("无效视频必须导出失败");

        assert!(error.contains("FFmpeg 退出码"));
        assert!(error.contains("Invalid data") || error.contains("无效"));
        assert!(!output.exists(), "失败时不得留下目标 GIF");
        let remaining = std::fs::read_dir(&directory)
            .expect("应能读取 GIF 导出测试目录")
            .flatten()
            .count();
        assert_eq!(remaining, 1, "失败时不得留下临时 GIF");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn gif_export_converts_h264_mf_recording_and_replaces_existing_destination() {
        let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg.exe");
        let directory = std::env::temp_dir().join(format!(
            "niuery-gif-export-success-{}-{}",
            std::process::id(),
            super::now_millis(),
        ));
        std::fs::create_dir_all(&directory).expect("应能创建 GIF 导出测试目录");
        let input = directory.join("recording.mp4");
        let output = directory.join("recording.gif");

        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner", "-y", "-f", "lavfi", "-i",
                "testsrc2=size=1280x720:rate=60", "-t", "1", "-c:v", "h264_mf",
                "-b:v", "16M", "-pix_fmt", "yuv420p",
            ])
            .arg(&input)
            .status()
            .expect("应能启动随附 FFmpeg 生成 h264_mf 录制样本");
        assert!(status.success(), "应能生成 h264_mf 录制样本");
        std::fs::write(&output, b"previous GIF").expect("应能创建既有目标文件");

        export_gif_with_ffmpeg(
            &ffmpeg,
            &input,
            &output,
            &ExportOptions {
                fps: Some(12),
                max_width: Some(800),
                loop_count: Some(0),
            },
        )
        .expect("h264_mf 录制样本应能导出 GIF");

        let bytes = std::fs::read(&output).expect("应能读取导出的 GIF");
        assert!(bytes.starts_with(b"GIF89a") || bytes.starts_with(b"GIF87a"));
        assert!(bytes.len() > b"previous GIF".len());
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn failed_final_gif_replace_restores_existing_output_and_cleans_temporary_file() {
        let directory = std::env::temp_dir().join(format!(
            "niuery-gif-export-rollback-{}-{}",
            std::process::id(),
            super::now_millis(),
        ));
        std::fs::create_dir_all(&directory).expect("应能创建 GIF 回滚测试目录");
        let output = directory.join("recording.gif");
        let temporary = directory.join("recording.exporting.gif");
        std::fs::write(&output, b"old GIF contents").expect("应能写入已有 GIF");
        std::fs::write(&temporary, b"new GIF contents").expect("应能写入临时 GIF");

        let error = replace_gif_export_with(&temporary, &output, |from, to| {
            if from == temporary && to == output {
                return Err(std::io::Error::other("模拟最终替换失败"));
            }
            std::fs::rename(from, to)
        }, |path| std::fs::remove_file(path))
        .expect_err("最终替换失败时必须回滚");

        assert!(error.contains("已保留原 GIF"));
        assert_eq!(std::fs::read(&output).expect("旧 GIF 必须已恢复"), b"old GIF contents");
        assert!(!temporary.exists(), "回滚成功后必须清理临时 GIF");
        let remaining = std::fs::read_dir(&directory)
            .expect("应能读取 GIF 回滚测试目录")
            .flatten()
            .count();
        assert_eq!(remaining, 1, "回滚成功后不得遗留备份文件");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn retained_backup_is_reported_without_losing_the_new_gif() {
        let directory = std::env::temp_dir().join(format!(
            "niuery-gif-export-backup-warning-{}-{}",
            std::process::id(),
            super::now_millis(),
        ));
        std::fs::create_dir_all(&directory).expect("应能创建 GIF 备份告警测试目录");
        let output = directory.join("recording.gif");
        let temporary = directory.join("recording.exporting.gif");
        std::fs::write(&output, b"old GIF contents").expect("应能写入已有 GIF");
        std::fs::write(&temporary, b"new GIF contents").expect("应能写入临时 GIF");

        let warning = replace_gif_export_with(
            &temporary,
            &output,
            |from, to| std::fs::rename(from, to),
            |_path| Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "模拟备份占用")),
        )
        .expect("新 GIF 已写入时不能把备份清理失败视为整体导出失败")
        .expect("备份清理失败必须返回告警");

        assert!(warning.contains("新 GIF 已导出"));
        assert!(warning.contains(".previous-"));
        assert!(!warning.contains(directory.to_string_lossy().as_ref()), "告警不得包含完整本地路径");
        assert_eq!(std::fs::read(&output).expect("新 GIF 必须保留"), b"new GIF contents");
        assert!(!temporary.exists(), "新 GIF 移动后不应保留临时文件");
        let backup_count = std::fs::read_dir(&directory)
            .expect("应能读取 GIF 备份告警测试目录")
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".previous-"))
            .count();
        assert_eq!(backup_count, 1, "旧 GIF 备份必须保留以便用户恢复");
        let _ = std::fs::remove_dir_all(&directory);
    }
}
