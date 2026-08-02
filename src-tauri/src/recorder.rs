use image::{imageops, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifEditArtifact {
    pub path: String,
    pub size_bytes: u64,
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

pub fn build_ffmpeg_args(
    target: &CaptureTarget,
    settings: &RecordingSettings,
    width: u32,
    height: u32,
    output: &str,
) -> Vec<String> {
    build_ffmpeg_args_for_encoder(target, settings, width, height, output, "libx264")
}

fn build_ffmpeg_args_for_encoder(
    target: &CaptureTarget,
    settings: &RecordingSettings,
    width: u32,
    height: u32,
    output: &str,
    encoder: &str,
) -> Vec<String> {
    let crf = match settings.quality.as_str() {
        "high" => "18",
        "small" => "28",
        _ => "22",
    };
    let mut args = vec![
        "-y".to_string(),
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
            "high" => "12M",
            "small" => "3M",
            _ => "6M",
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
        ]);
    }
    if target.mode == "window" || target.mode == "region" || target.mode == "monitor" {
        args.push(output.to_string());
    }
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
    settings: RecordingSettings,
) -> Result<RecordingSession, String> {
    if !cfg!(target_os = "windows") {
        return Err("录屏目前仅支持 Windows".to_string());
    }
    let (width, height) = target_dimensions(&target)?;
    let ffmpeg = find_ffmpeg(&app)?;
    let state = app.state::<RecorderState>();
    let mut active = state
        .active
        .lock()
        .map_err(|_| "录屏状态不可用".to_string())?;
    if active.is_some() {
        return Err("已有录制任务正在进行".to_string());
    }

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
    let fps = settings.fps.clamp(1, 60);
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
    match format.as_str() {
        "mp4" => {
            std::fs::copy(&artifact.path, &destination)
                .map_err(|error| format!("导出 MP4 失败: {error}"))?;
        }
        "gif" => {
            export_gif(&app, &artifact.path, &destination, &options)?;
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
    })
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
    export_gif(
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
            }
            return Ok(artifact);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("停止录制超时，请稍后重试".to_string())
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
    let output_string = output.to_string_lossy().to_string();
    let encoder = select_video_encoder(ffmpeg);
    let mut child = Command::new(ffmpeg)
        .args(build_ffmpeg_args_for_encoder(
            &target,
            &settings,
            width,
            height,
            &output_string,
            encoder,
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 FFmpeg 视频输入".to_string())?;
    let started = Instant::now();
    let frame_duration = Duration::from_secs_f64(1.0 / fps as f64);
    let mut next_frame = Instant::now();
    let mut dropped_frames = 0u64;
    let mut written_frames = 0u64;
    let mut paused_since_ms = None;
    let mut paused_total_ms = 0u64;
    while !stop_requested.load(Ordering::Acquire) {
        let wall_elapsed_ms = started.elapsed().as_millis() as u64;
        if pause_requested.load(Ordering::Acquire) {
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
        stdin
            .write_all(frame.as_raw())
            .map_err(|error| format!("写入视频帧失败: {error}"))?;
        written_frames += 1;
        let elapsed_ms = recording_elapsed_ms(0, started.elapsed().as_millis() as u64, None, paused_total_ms);
        active_elapsed_ms.store(elapsed_ms, Ordering::Release);
        if written_frames % fps as u64 == 0 {
            let _ = app.emit(
                "recording-status",
                RecordingStatusEvent {
                    session_id: session_id.to_string(),
                    status: "recording".to_string(),
                    elapsed_ms,
                    fps,
                    dropped_frames,
                    error: None,
                },
            );
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
    drop(stdin);
    let status = child
        .wait()
        .map_err(|error| format!("FFmpeg 无法结束: {error}"))?;
    if !status.success() && !cancelled.load(Ordering::Acquire) {
        return Err("FFmpeg 编码失败，请确认打包的 FFmpeg 支持 libx264".to_string());
    }
    let size_bytes = std::fs::metadata(&output)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let artifact = RecordingArtifact {
        path: output.to_string_lossy().to_string(),
        duration_ms: elapsed_ms,
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
            fps,
            dropped_frames,
            error: None,
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
) -> Result<(), String> {
    let ffmpeg = find_ffmpeg(app)?;
    let fps = options.fps.unwrap_or(12).clamp(1, 30);
    let max_width = options.max_width.unwrap_or(800).clamp(64, 1920);
    let filter = format!("fps={fps},scale='min({max_width},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse");
    let status = Command::new(ffmpeg)
        .args([
            "-y",
            "-i",
            input,
            "-vf",
            &filter,
            output.to_string_lossy().as_ref(),
        ])
        .status()
        .map_err(|error| format!("无法启动 GIF 导出: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("GIF 导出失败".to_string())
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
