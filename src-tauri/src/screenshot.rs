use base64::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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

/// 弹出保存对话框，将 base64 PNG 保存到文件
#[tauri::command]
pub fn save_image_dialog(base64_data: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("解码 base64 失败: {e}"))?;

    let path = rfd::FileDialog::new()
        .add_filter("PNG 图片", &["png"])
        .add_filter("JPEG 图片", &["jpg", "jpeg"])
        .set_file_name("screenshot")
        .save_file();

    match path {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {e}"))?;
            Ok(true)
        }
        None => Ok(false),
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
