use base64::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// 长截图边框外扩宽度（CSS 像素）：边框画在窗口外环，内洞恰为捕获区域，
/// 保证置顶边框不会被拍进连拍帧
const LONGSHOT_BORDER_WIDTH: f64 = 3.0;

/// 长截图会话期间临时注册的全局结束键
const LONGSHOT_ESC: &str = "Esc";

/// 注册长截图临时全局 Esc（先注销再注册，防止上一次会话残留）
pub fn register_longshot_esc(app: &AppHandle) {
    if let Ok(shortcut) = LONGSHOT_ESC.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
        let _ = app.global_shortcut().register(shortcut);
    }
}

/// 注销长截图临时全局 Esc（边框窗口销毁时调用，防止泄漏）
pub fn unregister_longshot_esc(app: &AppHandle) {
    if let Ok(shortcut) = LONGSHOT_ESC.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// 判断触发的快捷键是否为长截图临时 Esc
pub fn is_longshot_esc(shortcut: &Shortcut) -> bool {
    LONGSHOT_ESC
        .parse::<Shortcut>()
        .map(|s| s == *shortcut)
        .unwrap_or(false)
}

/// 自动滚动会话是否正在隐藏系统光标（防止光标被拍进连拍帧）
static LONGSHOT_CURSOR_HIDDEN: AtomicBool = AtomicBool::new(false);

/// 隐藏系统光标（自动滚动会话开始时）
pub fn hide_cursor_for_longshot() {
    #[cfg(windows)]
    if !LONGSHOT_CURSOR_HIDDEN.swap(true, Ordering::SeqCst) {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::ShowCursor(false);
        }
    }
}

/// 恢复系统光标（边框窗口销毁/会话结束时）
pub fn restore_cursor_for_longshot() {
    #[cfg(windows)]
    if LONGSHOT_CURSOR_HIDDEN.swap(false, Ordering::SeqCst) {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::ShowCursor(true);
        }
    }
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

/// 捕获全屏并打开截图窗口（异步，避免阻塞主线程）
/// mode 为 "longshot" 时进入长截图框选模式
#[tauri::command]
pub async fn start_screenshot(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    // 防重入：如果已有截图流程正在执行，直接返回，避免并发竞态导致卡死
    let state = app.state::<ScreenshotState>();
    if state.in_progress.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
        return Ok(());
    }

    // 确保无论成功还是失败，最终都释放标志
    let result = do_start_screenshot(app.clone(), mode).await;
    let state = app.state::<ScreenshotState>();
    state.in_progress.store(false, Ordering::Release);
    result
}

async fn do_start_screenshot(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    // 长截图入口（界面按钮/全局快捷键）会先最小化主窗口再启动截屏。
    // 最小化动画约需 250ms，若立即截屏，首帧画面仍包含主窗口，
    // 全屏选区窗口展示该静态截图时看起来就像窗口又被恢复了。
    // 因此检测到主窗口处于最小化状态时，先等待动画结束且桌面合成刷新。
    if let Some(main) = app.get_webview_window("main") {
        if main.is_minimized().unwrap_or(false) {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
    }

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
    let url = match mode.as_deref() {
        Some("longshot") => "index.html#/screenshot?mode=longshot",
        _ => "index.html#/screenshot",
    };
    WebviewWindowBuilder::new(
        &app,
        "screenshot",
        WebviewUrl::App(url.into()),
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

/// 在指定位置（主显示器 CSS 像素坐标）发送滚轮向下事件，用于长截图自动滚动。
/// Windows 将滚轮路由到光标下的窗口，因此发送前先把光标移到该位置。
#[tauri::command]
pub fn send_scroll_wheel(app: AppHandle, x: f64, y: f64, notches: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEINPUT, MOUSEEVENTF_WHEEL,
        };
        use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

        let scale = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);
        let px = (x * scale).round() as i32;
        let py = (y * scale).round() as i32;
        unsafe {
            SetCursorPos(px, py).map_err(|e| format!("移动光标失败: {e}"))?;
            // WHEEL_DELTA = 120，向下为负
            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: (-120_i32 * notches) as u32,
                        dwFlags: MOUSEEVENTF_WHEEL,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, x, y, notches);
        Err("自动滚动仅 Windows 支持".to_string())
    }
}

/// 截取主显示器上的指定区域（CSS 像素坐标），返回 base64 PNG
/// 用于长截图定时连拍
#[tauri::command]
pub async fn capture_screen_region(x: f64, y: f64, width: f64, height: f64) -> Result<String, String> {
    if width < 1.0 || height < 1.0 {
        return Err("截取区域尺寸无效".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器失败: {e}"))?;
        let monitor = monitors.first().ok_or_else(|| "未找到显示器".to_string())?;
        let image = monitor
            .capture_image()
            .map_err(|e| format!("截屏失败: {e}"))?;

        let scale = monitor.scale_factor() as f64;
        // CSS 坐标 → 物理像素，并与屏幕边界取交集
        let px = (x * scale).round() as i64;
        let py = (y * scale).round() as i64;
        let img_w = image.width() as i64;
        let img_h = image.height() as i64;
        let cx = px.max(0);
        let cy = py.max(0);
        let cx2 = (px + (width * scale).round() as i64).min(img_w);
        let cy2 = (py + (height * scale).round() as i64).min(img_h);
        if cx2 <= cx || cy2 <= cy {
            return Err("截取区域超出屏幕范围".to_string());
        }
        let cropped = image::imageops::crop_imm(&image, cx as u32, cy as u32, (cx2 - cx) as u32, (cy2 - cy) as u32)
            .to_image();

        // 缩放回 CSS 像素尺寸，与前端坐标约定保持一致
        let out_w = ((cx2 - cx) as f64 / scale).round().max(1.0) as u32;
        let out_h = ((cy2 - cy) as f64 / scale).round().max(1.0) as u32;
        let resized = if (scale - 1.0).abs() > 0.01 {
            image::imageops::resize(&cropped, out_w, out_h, image::imageops::FilterType::Lanczos3)
        } else {
            cropped
        };

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
    .map_err(|e| format!("截屏线程异常: {e}"))?
}

/// 打开长截图呼吸边框窗口（透明、置顶、光标穿透、不抢焦点；
/// 选区坐标/捕获间隔/滚动模式通过 URL 查询参数传递，确认后不可修改；
/// 会话期间临时注册全局 Esc 用于结束拼接；自动滚动模式隐藏系统光标）
#[tauri::command]
pub async fn start_longshot_panel(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    interval_ms: Option<u32>,
    auto_scroll: Option<bool>,
) -> Result<(), String> {
    // 关闭已有边框窗口，轮询等待标签释放（窗口销毁事件会同时注销 Esc）
    if let Some(win) = app.get_webview_window("longshot-panel") {
        let _ = win.close();
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if app.get_webview_window("longshot-panel").is_none() {
                break;
            }
        }
    }

    // 窗口相对选区外扩一个边框宽度：边框画在外环、内洞恰为捕获区域，
    // 置顶边框因此不会进入连拍帧；贴近屏幕边缘时夹紧
    let b = LONGSHOT_BORDER_WIDTH;
    let (screen_w, screen_h) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let s = m.scale_factor();
            let size = m.size();
            (size.width as f64 / s, size.height as f64 / s)
        }
        _ => (f64::MAX, f64::MAX),
    };
    let win_x = (x - b).max(0.0);
    let win_y = (y - b).max(0.0);
    let win_w = ((x + width + b).min(screen_w) - win_x).max(1.0);
    let win_h = ((y + height + b).min(screen_h) - win_y).max(1.0);

    let interval = interval_ms.unwrap_or(1000).clamp(300, 3000);
    let auto = auto_scroll.unwrap_or(true);
    // 自动模式节奏夹紧 ≥600ms，覆盖平滑滚动动画稳定时间
    let interval = if auto { interval.max(600) } else { interval };
    let url = format!(
        "index.html#/longshot-panel?x={}&y={}&w={}&h={}&i={}&a={}",
        x.round(),
        y.round(),
        width.round(),
        height.round(),
        interval,
        if auto { 1 } else { 0 }
    );
    let win = WebviewWindowBuilder::new(&app, "longshot-panel", WebviewUrl::App(url.into()))
        .title("长截图")
        .position(win_x, win_y)
        .inner_size(win_w, win_h)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .build()
        .map_err(|e| format!("打开长截图边框窗口失败: {e}"))?;

    // 光标穿透：所有鼠标/滚轮操作落到下方内容，用户可直接滚动目标窗口；
    // 不调用 set_focus，避免抢占目标窗口焦点
    let _ = win.set_ignore_cursor_events(true);

    // 自动滚动模式隐藏系统光标，防止被拍进连拍帧（窗口销毁时恢复）
    if auto {
        hide_cursor_for_longshot();
    }

    // 注册临时全局 Esc（结束并拼接），窗口销毁时注销
    register_longshot_esc(&app);
    Ok(())
}

/// 关闭长截图悬浮控制面板
#[tauri::command]
pub fn close_longshot_panel(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("longshot-panel") {
        win.close().map_err(|e| format!("关闭面板失败: {e}"))?;
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
