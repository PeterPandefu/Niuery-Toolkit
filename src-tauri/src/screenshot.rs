use base64::Engine;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, POINT},
    UI::{
        Input::KeyboardAndMouse::{mouse_event, MOUSEEVENTF_WHEEL},
        WindowsAndMessaging::{
            GetAncestor, GetCursorPos, GetForegroundWindow, IsIconic, IsWindow, SetCursorPos,
            SetForegroundWindow, ShowWindow, WindowFromPoint, GetWindowThreadProcessId, GA_ROOT, SW_RESTORE,
        },
    },
};

#[cfg(target_os = "windows")]
fn hwnd_from_id(id: u32) -> HWND {
    HWND(id as usize as *mut std::ffi::c_void)
}

/// 截图状态：保存最近一次全屏截图的 base64 PNG 数据
pub struct ScreenshotState {
    pub screen_data: Mutex<Option<String>>,
    /// 防止并发调用 start_screenshot 导致竞态卡死
    pub in_progress: AtomicBool,
}

impl Default for ScreenshotState {
    fn default() -> Self {
        Self {
            screen_data: Mutex::new(None),
            in_progress: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongScreenshotSource {
    pub source_type: String,
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub process_id: Option<u32>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongScreenshotFrame {
    pub image: String,
    pub width: u32,
    pub height: u32,
    pub coordinate_width: u32,
    pub coordinate_height: u32,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedLongScreenshotSource {
    pub active_window_id: u32,
    pub active_process_id: u32,
    pub pointer_x: i32,
    pub pointer_y: i32,
}

fn encode_png(image: &image::RgbaImage) -> Result<String, String> {
    let mut buf = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut buf),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("编码 PNG 失败: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// xcap window images are scaled to their monitor DPI, while input/window
/// coordinates use the window's client coordinate system. Convert only after
/// validating against the exact preview image the user selected from.
fn map_capture_coordinate(
    capture_coordinate: i32,
    capture_length: u32,
    input_length: u32,
) -> Result<i32, String> {
    if capture_coordinate < 0 || capture_length == 0 || input_length == 0 || capture_coordinate >= capture_length as i32 {
        return Err("截图区域已超出目标窗口".to_string());
    }
    Ok(((capture_coordinate as i64 * input_length as i64) / capture_length as i64) as i32)
}

fn capture_long_screenshot_source_blocking(
    source_type: &str,
    source_id: u32,
    expected_process_id: Option<u32>,
) -> Result<LongScreenshotFrame, String> {
    let (image, x, y, coordinate_width, coordinate_height) = match source_type {
        "window" => {
            let window = xcap::Window::all()
                .map_err(|e| format!("枚举窗口失败: {e}"))?
                .into_iter()
                .find(|item| item.id() == source_id)
                .ok_or_else(|| "目标窗口已关闭或不可捕获".to_string())?;
            if window.is_minimized() {
                return Err("目标窗口已最小化".to_string());
            }
            #[cfg(target_os = "windows")]
            if expected_process_id.is_some_and(|expected| expected != window.process_id()) {
                return Err("目标窗口已更换，长截图已暂停".to_string());
            }
            let x = window.x();
            let y = window.y();
            let image = window
                .capture_image()
                .map_err(|e| format!("捕获窗口失败: {e}"))?;
            (image, x, y, window.width(), window.height())
        }
        "monitor" => {
            let monitor = xcap::Monitor::all()
                .map_err(|e| format!("枚举显示器失败: {e}"))?
                .into_iter()
                .find(|item| item.id() == source_id)
                .ok_or_else(|| "目标显示器已不可用".to_string())?;
            let x = monitor.x();
            let y = monitor.y();
            let image = monitor
                .capture_image()
                .map_err(|e| format!("捕获显示器失败: {e}"))?;
            (image, x, y, monitor.width(), monitor.height())
        }
        _ => return Err("不支持的截图来源".to_string()),
    };

    Ok(LongScreenshotFrame {
        width: image.width(),
        height: image.height(),
        coordinate_width,
        coordinate_height,
        image: encode_png(&image)?,
        x,
        y,
    })
}

/// 列出可作为自动长截图来源的应用窗口和显示器。
#[tauri::command]
pub async fn list_long_screenshot_sources() -> Result<Vec<LongScreenshotSource>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sources = Vec::new();
        for window in xcap::Window::all().map_err(|e| format!("枚举窗口失败: {e}"))? {
            if window.is_minimized() || window.width() < 64 || window.height() < 64 {
                continue;
            }
            sources.push(LongScreenshotSource {
                source_type: "window".to_string(),
                id: window.id(),
                title: if window.title().trim().is_empty() {
                    window.app_name().to_string()
                } else {
                    window.title().to_string()
                },
                app_name: window.app_name().to_string(),
                process_id: {
                    #[cfg(target_os = "windows")]
                    { Some(window.process_id()) }
                    #[cfg(not(target_os = "windows"))]
                    { None }
                },
                width: window.width(),
                height: window.height(),
            });
        }
        for monitor in xcap::Monitor::all().map_err(|e| format!("枚举显示器失败: {e}"))? {
            sources.push(LongScreenshotSource {
                source_type: "monitor".to_string(),
                id: monitor.id(),
                title: format!("显示器 {}", monitor.id()),
                app_name: "整屏备用来源".to_string(),
                process_id: None,
                width: monitor.width(),
                height: monitor.height(),
            });
        }
        Ok::<Vec<LongScreenshotSource>, String>(sources)
    })
    .await
    .map_err(|e| format!("枚举截图来源失败: {e}"))?
}

/// 捕获一个选定来源的最新画面。图像只回传到前端内存，不写入磁盘。
#[tauri::command]
pub async fn capture_long_screenshot_source(
    source_type: String,
    source_id: u32,
    expected_process_id: Option<u32>,
) -> Result<LongScreenshotFrame, String> {
    tauri::async_runtime::spawn_blocking(move || {
        capture_long_screenshot_source_blocking(&source_type, source_id, expected_process_id)
    })
    .await
    .map_err(|e| format!("截图线程异常: {e}"))?
}

/// 将选定窗口（或整屏中鼠标所在的窗口）置前，并把滚轮定位到框选区域。
#[tauri::command]
pub fn prepare_long_screenshot_source(
    source_type: String,
    source_id: u32,
    selection_x: i32,
    selection_y: i32,
    capture_width: u32,
    capture_height: u32,
    expected_process_id: Option<u32>,
) -> Result<PreparedLongScreenshotSource, String> {
    #[cfg(target_os = "windows")]
    {
        let (pointer_x, pointer_y, active_window_id, active_process_id) = match source_type.as_str() {
            "window" => {
                let window = xcap::Window::all()
                    .map_err(|e| format!("枚举窗口失败: {e}"))?
                    .into_iter()
                    .find(|item| item.id() == source_id)
                    .ok_or_else(|| "目标窗口已关闭或不可捕获".to_string())?;
                let input_x = map_capture_coordinate(selection_x, capture_width, window.width())?;
                let input_y = map_capture_coordinate(selection_y, capture_height, window.height())?;
                if expected_process_id.is_some_and(|expected| expected != window.process_id()) {
                    return Err("目标窗口已更换，长截图已暂停".to_string());
                }
                (window.x() + input_x, window.y() + input_y, window.id(), window.process_id())
            }
            "monitor" => {
                let monitor = xcap::Monitor::all()
                    .map_err(|e| format!("枚举显示器失败: {e}"))?
                    .into_iter()
                    .find(|item| item.id() == source_id)
                    .ok_or_else(|| "目标显示器已不可用".to_string())?;
                let input_x = map_capture_coordinate(selection_x, capture_width, monitor.width())?;
                let input_y = map_capture_coordinate(selection_y, capture_height, monitor.height())?;
                let pointer_x = monitor.x() + input_x;
                let pointer_y = monitor.y() + input_y;
                let hovered = unsafe { WindowFromPoint(POINT { x: pointer_x, y: pointer_y }) };
                if hovered.0.is_null() {
                    return Err("框选区域内没有可滚动窗口".to_string());
                }
                let root = unsafe { GetAncestor(hovered, GA_ROOT) };
                if root.0.is_null() {
                    return Err("无法确定框选区域所属窗口".to_string());
                }
                let mut process_id = 0;
                unsafe { GetWindowThreadProcessId(root, Some(&mut process_id)); }
                if process_id == 0 {
                    return Err("无法确定目标窗口进程".to_string());
                }
                (pointer_x, pointer_y, root.0 as u32, process_id)
            }
            _ => return Err("不支持的截图来源".to_string()),
        };

        let hwnd = hwnd_from_id(active_window_id);
        unsafe {
            if !IsWindow(hwnd).as_bool() {
                return Err("目标窗口已关闭".to_string());
            }
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err("无法激活目标窗口".to_string());
            }
            SetCursorPos(pointer_x, pointer_y)
                .map_err(|e| format!("无法定位滚轮: {e}"))?;
        }

        return Ok(PreparedLongScreenshotSource {
            active_window_id,
            active_process_id,
            pointer_x,
            pointer_y,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (source_type, source_id, selection_x, selection_y, capture_width, capture_height, expected_process_id);
        Err("自动长截图目前仅支持 Windows 桌面端".to_string())
    }
}

/// 仅在目标窗口仍处于前台时发送一次滚轮，防止误滚动到其他应用。
#[tauri::command]
pub fn scroll_long_screenshot_source(
    active_window_id: u32,
    active_process_id: u32,
    pointer_x: i32,
    pointer_y: i32,
    wheel_delta: i32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_from_id(active_window_id);
        unsafe {
            if !IsWindow(hwnd).as_bool() {
                return Err("目标窗口已关闭".to_string());
            }
            let mut current_process_id = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut current_process_id));
            if current_process_id != active_process_id {
                return Err("目标窗口已更换，长截图已暂停".to_string());
            }
            if GetForegroundWindow() != hwnd {
                return Err("目标窗口已失焦，长截图已暂停".to_string());
            }
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor).map_err(|e| format!("无法读取鼠标位置: {e}"))?;
            if cursor.x != pointer_x || cursor.y != pointer_y {
                return Err("检测到鼠标已移动，长截图已暂停".to_string());
            }
            SetCursorPos(pointer_x, pointer_y)
                .map_err(|e| format!("无法定位滚轮: {e}"))?;
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, wheel_delta, 0);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (active_window_id, active_process_id, pointer_x, pointer_y, wheel_delta);
        Err("自动长截图目前仅支持 Windows 桌面端".to_string())
    }
}

/// 捕获全屏并打开截图窗口（异步，避免阻塞主线程）
#[tauri::command]
pub async fn start_screenshot(app: AppHandle) -> Result<(), String> {
    // 防重入：如果已有截图流程正在执行，直接返回，避免并发竞态导致卡死
    let state = app.state::<ScreenshotState>();
    if state.in_progress.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
        return Ok(());
    }

    // 确保无论成功还是失败，最终都释放标志
    let result = do_start_screenshot(app.clone()).await;
    let state = app.state::<ScreenshotState>();
    state.in_progress.store(false, Ordering::Release);
    result
}

async fn do_start_screenshot(app: AppHandle) -> Result<(), String> {
    // 在后台线程执行耗时的截屏 + 编码操作，避免阻塞 Tauri 事件循环
    let base64_data = tauri::async_runtime::spawn_blocking(move || {
        let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器失败: {e}"))?;
        let monitor = monitors.first().ok_or_else(|| "未找到显示器".to_string())?;
        let image = monitor
            .capture_image()
            .map_err(|e| format!("截屏失败: {e}"))?;

        // 按 DPI 缩放比缩放到 CSS 像素尺寸，使前端坐标与屏幕坐标一致
        let scale = monitor.scale_factor() as f64;
        let css_w = (image.width() as f64 / scale).round() as u32;
        let css_h = (image.height() as f64 / scale).round() as u32;
        let resized = if (scale - 1.0).abs() > 0.01 {
            image::imageops::resize(&image, css_w, css_h, image::imageops::FilterType::Lanczos3)
        } else {
            image.clone()
        };

        // 编码为 PNG base64
        let mut buf: Vec<u8> = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut buf);
            resized
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| format!("编码 PNG 失败: {e}"))?;
        }
        Ok::<String, String>(base64::engine::general_purpose::STANDARD.encode(&buf))
    })
    .await
    .map_err(|e| format!("截屏线程异常: {e}"))??;

    // 存入状态
    {
        let state = app.state::<ScreenshotState>();
        *state.screen_data.lock().unwrap() = Some(base64_data);
    }

    // 关闭已有截图窗口，轮询等待标签释放
    if let Some(win) = app.get_webview_window("screenshot") {
        let _ = win.close();
        // 轮询等待窗口完全销毁，最多等待 2 秒
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if app.get_webview_window("screenshot").is_none() {
                break;
            }
        }
    }

    // 打开透明截图窗口（先隐藏且不全屏，等前端渲染就绪后再全屏+显示）
    // 注意：fullscreen + visible(false) 在 Windows 上组合使用会导致 show() 异常
    WebviewWindowBuilder::new(
        &app,
        "screenshot",
        WebviewUrl::App("index.html#/screenshot".into()),
    )
    .title("Screenshot")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build()
    .map_err(|e| format!("打开截图窗口失败: {e}"))?;

    Ok(())
}

/// 获取已捕获的屏幕截图 base64 数据
#[tauri::command]
pub fn get_screen_capture(app: AppHandle) -> Result<String, String> {
    let state = app.state::<ScreenshotState>();
    let data = state.screen_data.lock().unwrap();
    data.clone().ok_or_else(|| "暂无截图数据".to_string())
}

/// 将 base64 PNG 图片写入系统剪贴板
#[tauri::command]
pub fn copy_image_to_clipboard(base64_data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("解码 base64 失败: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("解析图片失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let img_data = arboard::ImageData {
        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        width: w as usize,
        height: h as usize,
    };
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .set_image(img_data)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    Ok(())
}

/// 弹出保存对话框，将 base64 图片保存到文件并返回实际路径
#[tauri::command]
pub fn save_image_dialog(base64_data: String, format: Option<String>) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("解码 base64 失败: {e}"))?;

    let format = format.as_deref().unwrap_or("png");
    let (filter_name, extensions, default_extension) = match format {
        "jpeg" => ("JPEG 图片", &["jpg", "jpeg"][..], "jpg"),
        "webp" => ("WebP 图片", &["webp"][..], "webp"),
        _ => ("PNG 图片", &["png"][..], "png"),
    };
    let path = rfd::FileDialog::new()
        .add_filter(filter_name, extensions)
        .set_file_name(format!("screenshot.{default_extension}"))
        .save_file();

    match path {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// 关闭截图窗口
#[tauri::command]
pub fn close_screenshot_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("screenshot") {
        win.close().map_err(|e| format!("关闭窗口失败: {e}"))?;
    }
    Ok(())
}

/// 前端渲染就绪后全屏并显示截图窗口
#[tauri::command]
pub fn show_screenshot_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("screenshot") {
        // 先设置全屏，再显示，最后聚焦
        win.set_fullscreen(true)
            .map_err(|e| format!("全屏失败: {e}"))?;
        win.show().map_err(|e| format!("显示窗口失败: {e}"))?;
        win.set_focus().map_err(|e| format!("聚焦窗口失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::map_capture_coordinate;

    #[test]
    fn maps_preview_pixels_back_to_window_input_coordinates_at_high_dpi() {
        // xcap returns a 1,600px capture for a 1,280px client area at 125% DPI.
        assert_eq!(map_capture_coordinate(750, 1_600, 1_280).unwrap(), 600);
    }

    #[test]
    fn rejects_preview_coordinates_outside_the_captured_image() {
        assert!(map_capture_coordinate(1_600, 1_600, 1_280).is_err());
    }
}
