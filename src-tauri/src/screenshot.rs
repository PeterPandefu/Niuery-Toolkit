use base64::Engine;
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// 截图窗口必须在该时限内完成首帧渲染并主动显示，否则自动清理隐藏窗口。
const SCREENSHOT_READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
/// 原生捕获或窗口创建超过该时限时放弃本次会话，防止快捷键永久处于忙碌状态。
const SCREENSHOT_START_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(12);

/// 长截图边框外扩宽度（CSS 像素）：边框画在窗口外环，内洞恰为捕获区域，
/// 保证置顶边框不会被拍进连拍帧
const LONGSHOT_BORDER_WIDTH: f64 = 3.0;

/// 长截图会话期间临时注册的全局结束键
const LONGSHOT_ESC: &str = "Esc";
/// 截图框选会话期间临时注册的全局取消键。即使全屏 WebView 未能获得焦点，
/// 也能让用户退出，避免透明置顶窗口看起来像软件卡死。
const SCREENSHOT_ESC: &str = "Esc";

/// 注册截图会话的全局 Esc 兜底取消键。
pub fn register_screenshot_esc(app: &AppHandle) {
    if let Ok(shortcut) = SCREENSHOT_ESC.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
        let _ = app.global_shortcut().register(shortcut);
    }
}

/// 注销截图会话的全局 Esc 兜底取消键。
pub fn unregister_screenshot_esc(app: &AppHandle) {
    if let Ok(shortcut) = SCREENSHOT_ESC.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// 判断触发的快捷键是否为截图会话的临时 Esc。
pub fn is_screenshot_esc(shortcut: &Shortcut) -> bool {
    SCREENSHOT_ESC
        .parse::<Shortcut>()
        .map(|s| s == *shortcut)
        .unwrap_or(false)
}

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

/// 一次可供预热框选窗口加载的截图数据。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCapture {
    pub generation: u64,
    pub mode: String,
    pub path: String,
}

/// 截图数据已更新事件的轻量载荷。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotCaptureReady {
    generation: u64,
}

/// 截图缓存只有在登记进当前会话后才保留；失败、超时或取消都会自动删除半成品。
struct PendingScreenshotFile {
    path: PathBuf,
    retained: bool,
}

impl PendingScreenshotFile {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            retained: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn retain(mut self) -> PathBuf {
        self.retained = true;
        std::mem::take(&mut self.path)
    }
}

impl Drop for PendingScreenshotFile {
    fn drop(&mut self) {
        if !self.retained {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// 截图状态：保存最近一次全屏截图及会话状态。
pub struct ScreenshotState {
    pub screen_data: Mutex<Option<ScreenshotCapture>>,
    /// 是否在常规截图前最小化主窗口。
    minimize_before_capture: AtomicBool,
    /// 未最小化截图时，捕获完成后曾隐藏主窗口；框选窗口关闭后需要恢复它。
    restore_main_after_close: AtomicBool,
    /// 启用截图前最小化时先瞬时隐藏主窗口；截图结束后恢复为最小化状态。
    restore_main_as_minimized: AtomicBool,
    /// 从开始捕获到截图窗口销毁期间始终保持占用，防止快捷键重入重建置顶窗口。
    in_progress: AtomicBool,
    /// 前端首帧完成后由 show_screenshot_window 标记，用于识别半初始化窗口。
    window_ready: AtomicBool,
    /// 区分前后两次会话，避免旧看门狗误清理新会话。
    generation: AtomicU64,
}

/// 截图工具配置。
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScreenshotSettings {
    pub minimize_before_capture: bool,
}

impl Default for ScreenshotSettings {
    fn default() -> Self {
        Self {
            minimize_before_capture: true,
        }
    }
}

impl Default for ScreenshotState {
    fn default() -> Self {
        Self {
            screen_data: Mutex::new(None),
            minimize_before_capture: AtomicBool::new(true),
            restore_main_after_close: AtomicBool::new(false),
            restore_main_as_minimized: AtomicBool::new(false),
            in_progress: AtomicBool::new(false),
            window_ready: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        }
    }
}

impl ScreenshotState {
    fn settings(&self) -> ScreenshotSettings {
        ScreenshotSettings {
            minimize_before_capture: self.minimize_before_capture.load(Ordering::Acquire),
        }
    }

    pub fn set_minimize_before_capture(&self, minimize_before_capture: bool) {
        self.minimize_before_capture
            .store(minimize_before_capture, Ordering::Release);
    }

    fn try_begin_session(&self) -> Option<u64> {
        self.in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        self.window_ready.store(false, Ordering::Release);
        Some(self.generation.fetch_add(1, Ordering::AcqRel) + 1)
    }

    fn mark_current_ready(&self) {
        if self.in_progress.load(Ordering::Acquire) {
            self.window_ready.store(true, Ordering::Release);
        }
    }

    fn should_cleanup(&self, generation: u64) -> bool {
        self.in_progress.load(Ordering::Acquire)
            && self.generation.load(Ordering::Acquire) == generation
            && !self.window_ready.load(Ordering::Acquire)
    }

    fn release_if_generation(&self, generation: u64) {
        if self.generation.load(Ordering::Acquire) == generation {
            self.window_ready.store(false, Ordering::Release);
            self.in_progress.store(false, Ordering::Release);
            let mut capture = self.screen_data.lock().unwrap();
            if capture.as_ref().map(|item| item.generation) == Some(generation) {
                if let Some(item) = capture.take() {
                    let _ = std::fs::remove_file(item.path);
                }
            }
        }
    }

    fn release_current(&self) {
        self.window_ready.store(false, Ordering::Release);
        self.in_progress.store(false, Ordering::Release);
        if let Some(item) = self.screen_data.lock().unwrap().take() {
            let _ = std::fs::remove_file(item.path);
        }
    }

    fn is_active(&self) -> bool {
        self.in_progress.load(Ordering::Acquire)
    }

    fn current_generation(&self) -> Option<u64> {
        self.is_active()
            .then(|| self.generation.load(Ordering::Acquire))
    }

    fn is_generation_active(&self, generation: u64) -> bool {
        self.in_progress.load(Ordering::Acquire)
            && self.generation.load(Ordering::Acquire) == generation
    }

    fn mark_main_hidden_for_screenshot(&self) {
        self.restore_main_after_close.store(true, Ordering::Release);
    }

    fn mark_main_hidden_as_minimized(&self) {
        self.restore_main_as_minimized
            .store(true, Ordering::Release);
    }

    fn take_main_minimized_request(&self) -> bool {
        self.restore_main_as_minimized.swap(false, Ordering::AcqRel)
    }

    fn take_main_restore_request(&self) -> bool {
        self.restore_main_after_close.swap(false, Ordering::AcqRel)
    }
}

fn screenshot_config_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("screenshot.json")
}

/// 从配置文件加载截图工具配置。
pub fn load_screenshot_settings(app: &AppHandle) -> ScreenshotSettings {
    std::fs::read_to_string(screenshot_config_path(app))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_screenshot_settings(app: &AppHandle, settings: &ScreenshotSettings) {
    let path = screenshot_config_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        path,
        serde_json::to_string_pretty(settings).unwrap_or_default(),
    );
}

/// 获取当前截图工具配置。
#[tauri::command]
pub fn get_screenshot_settings(app: AppHandle) -> ScreenshotSettings {
    app.state::<ScreenshotState>().settings()
}

/// 更新“截图前最小化主窗口”配置。
#[tauri::command]
pub fn set_screenshot_minimize_before_capture(app: AppHandle, minimize_before_capture: bool) {
    let state = app.state::<ScreenshotState>();
    state.set_minimize_before_capture(minimize_before_capture);
    save_screenshot_settings(&app, &state.settings());
}

/// 供全局快捷键读取当前是否应在截图前最小化主窗口。
pub fn should_minimize_before_capture(app: &AppHandle) -> bool {
    app.state::<ScreenshotState>()
        .minimize_before_capture
        .load(Ordering::Acquire)
}

/// 常规截图在不最小化模式下，先保留当前窗口画面，再隐藏主窗口。
/// 这样截图本身仍包含当前工具，同时避免主窗口与全屏截图窗口争夺前台焦点。
fn hide_visible_main(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    let visible = main.is_visible().unwrap_or(false);
    let minimized = main.is_minimized().unwrap_or(false);
    visible && !minimized && main.hide().is_ok()
}

fn hide_main_after_capture(app: &AppHandle) -> bool {
    if !hide_visible_main(app) {
        return false;
    }
    app.state::<ScreenshotState>()
        .mark_main_hidden_for_screenshot();
    true
}

/// 需要排除主窗口时立即隐藏，避免等待 Windows 最小化动画。
fn hide_main_before_capture(app: &AppHandle) -> bool {
    if !hide_visible_main(app) {
        return false;
    }
    app.state::<ScreenshotState>()
        .mark_main_hidden_as_minimized();
    // hide() 返回后等待桌面合成器完成一次提交，确保随后 BitBlt 不会读到主窗口残影。
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::Graphics::Dwm::DwmFlush();
    }
    true
}

/// 恢复截图前临时隐藏的主窗口，并按入口配置还原为前台或最小化状态。
pub fn restore_main_after_screenshot(app: &AppHandle) {
    if app.state::<ScreenshotState>().take_main_minimized_request() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.minimize();
        }
        return;
    }
    if !app.state::<ScreenshotState>().take_main_restore_request() {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// 捕获全屏并打开截图窗口（异步，避免阻塞主线程）
/// mode 为 "longshot" 时进入长截图框选模式
#[tauri::command]
pub async fn start_screenshot(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    // 在共享入口锁内完成冲突检查和会话占用，避免截图与录屏并发启动。
    let generation = {
        let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
        let _capture_guard = guard_state.lock()?;
        if crate::recorder::active_session_id(&app).is_some()
            || app.get_webview_window("longshot-panel").is_some()
        {
            return Ok(());
        }

        // 防重入范围覆盖完整截图会话，而不只是捕获和建窗阶段。
        let state = app.state::<ScreenshotState>();
        match state.try_begin_session() {
            Some(generation) => generation,
            None => return Ok(()),
        }
    };
    if mode.as_deref() == Some("longshot") || should_minimize_before_capture(&app) {
        hide_main_before_capture(&app);
    }
    // 全屏窗口还未显示或意外失焦时，仍可通过 Esc 可靠退出本次截图。
    register_screenshot_esc(&app);

    match tokio::time::timeout(
        SCREENSHOT_START_TIMEOUT,
        do_start_screenshot(app.clone(), mode, generation),
    )
    .await
    {
        Ok(Ok(())) => {
            let watchdog_app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(SCREENSHOT_READY_TIMEOUT).await;
                let should_cleanup = watchdog_app
                    .state::<ScreenshotState>()
                    .should_cleanup(generation);
                if !should_cleanup {
                    return;
                }
                cleanup_unready_screenshot_generation(&watchdog_app, generation);
            });
            Ok(())
        }
        Ok(Err(error)) => {
            cleanup_unready_screenshot_generation(&app, generation);
            Err(error)
        }
        Err(_) => {
            cleanup_unready_screenshot_generation(&app, generation);
            Err("截图启动超时，请稍后重试".to_string())
        }
    }
}

/// 当前是否已有截图框选窗口或正在初始化的截图会话。
pub fn is_screenshot_session_active(app: &AppHandle) -> bool {
    app.state::<ScreenshotState>().is_active()
}

/// 返回当前截图会话编号，供延迟 Esc 清理绑定到触发时的会话。
pub fn current_screenshot_generation(app: &AppHandle) -> Option<u64> {
    app.state::<ScreenshotState>().current_generation()
}

/// 截图窗口销毁时释放会话占用，供统一窗口事件处理调用。
pub fn release_screenshot_session(app: &AppHandle) {
    app.state::<ScreenshotState>().release_current();
    unregister_screenshot_esc(app);
    restore_main_after_screenshot(app);
}

#[cfg(windows)]
fn capture_primary_image() -> Result<(image::RgbImage, f64), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows::Win32::UI::HiDpi::GetDpiForSystem;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN);
        let height = GetSystemMetrics(SM_CYSCREEN);
        if width <= 0 || height <= 0 {
            return Err("主显示器尺寸无效".to_string());
        }

        let desktop = HWND::default();
        let screen_dc = GetDC(desktop);
        if screen_dc.0.is_null() {
            return Err("获取桌面设备上下文失败".to_string());
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.0.is_null() {
            ReleaseDC(desktop, screen_dc);
            return Err("创建截图设备上下文失败".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.0.is_null() {
            let _ = DeleteDC(memory_dc);
            ReleaseDC(desktop, screen_dc);
            return Err("创建截图位图失败".to_string());
        }
        let previous = SelectObject(memory_dc, bitmap);

        let capture_result = (|| {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                screen_dc,
                0,
                0,
                SRCCOPY | CAPTUREBLT,
            )
            .map_err(|e| format!("复制桌面像素失败: {e}"))?;

            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
            info.bmiHeader.biWidth = width;
            // 负高度让 GDI 直接输出自上而下的像素行，避免额外垂直翻转。
            info.bmiHeader.biHeight = -height;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 24;
            info.bmiHeader.biCompression = BI_RGB.0;

            let packed_row_bytes = width as usize * 3;
            let gdi_row_bytes = (packed_row_bytes + 3) & !3;
            let mut gdi_pixels = vec![0_u8; gdi_row_bytes * height as usize];
            // GetDIBits 要求目标位图当前未选入任何 DC；先恢复原对象再读取像素。
            SelectObject(memory_dc, previous);
            let rows = GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                Some(gdi_pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            if rows != height {
                return Err(format!("读取桌面像素失败: 仅返回 {rows}/{height} 行"));
            }

            let mut pixels = if gdi_row_bytes == packed_row_bytes {
                gdi_pixels
            } else {
                let mut packed = Vec::with_capacity(packed_row_bytes * height as usize);
                for row in gdi_pixels.chunks_exact(gdi_row_bytes) {
                    packed.extend_from_slice(&row[..packed_row_bytes]);
                }
                packed
            };
            // GDI 输出 BGR；交换红蓝通道后直接形成 24 位 RGB，避免传输无用 Alpha。
            for pixel in pixels.chunks_exact_mut(3) {
                pixel.swap(0, 2);
            }
            let image = image::RgbImage::from_raw(width as u32, height as u32, pixels)
                .ok_or_else(|| "构造截图像素缓冲失败".to_string())?;
            let scale = GetDpiForSystem().max(96) as f64 / 96.0;
            Ok((image, scale))
        })();

        SelectObject(memory_dc, previous);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memory_dc);
        ReleaseDC(desktop, screen_dc);
        capture_result
    }
}

#[cfg(not(windows))]
fn capture_primary_image() -> Result<(image::RgbImage, f64), String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器失败: {e}"))?;
    let monitor = monitors.first().ok_or_else(|| "未找到显示器".to_string())?;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("截屏失败: {e}"))?;
    Ok((
        image::DynamicImage::ImageRgba8(image).into_rgb8(),
        monitor.scale_factor() as f64,
    ))
}

async fn do_start_screenshot(
    app: AppHandle,
    mode: Option<String>,
    generation: u64,
) -> Result<(), String> {
    let capture_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("获取截图缓存目录失败: {e}"))?;
    std::fs::create_dir_all(&capture_dir).map_err(|e| format!("创建截图缓存目录失败: {e}"))?;
    let capture_path = capture_dir.join(format!("screenshot-session-{generation}.png"));
    let worker_capture_path = capture_path.clone();

    // 在后台线程执行截屏并写入无压缩 PNG，避免压缩计算和大体积 Base64 IPC 复制。
    let pending_file = tauri::async_runtime::spawn_blocking(move || {
        let pending_file = PendingScreenshotFile::new(worker_capture_path);
        let (image, scale) = capture_primary_image()?;

        // 按 DPI 缩放比缩放到 CSS 像素尺寸，使前端坐标与屏幕坐标一致
        let css_w = (image.width() as f64 / scale).round() as u32;
        let css_h = (image.height() as f64 / scale).round() as u32;
        let resized = if (scale - 1.0).abs() > 0.01 {
            image::imageops::resize(&image, css_w, css_h, image::imageops::FilterType::Lanczos3)
        } else {
            image.clone()
        };
        let file = std::fs::File::create(pending_file.path())
            .map_err(|e| format!("创建截图缓存失败: {e}"))?;
        let mut writer = std::io::BufWriter::new(file);
        image::codecs::png::PngEncoder::new_with_quality(
            &mut writer,
            image::codecs::png::CompressionType::Uncompressed,
            image::codecs::png::FilterType::NoFilter,
        )
        .write_image(
            resized.as_raw(),
            resized.width(),
            resized.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("编码 PNG 失败: {e}"))?;
        Ok::<PendingScreenshotFile, String>(pending_file)
    })
    .await
    .map_err(|e| format!("截屏线程异常: {e}"))??;

    // 捕获完成后的登记、窗口切换和事件发送与 Esc 清理串行化：取消已发生时直接丢弃缓存，
    // 否则本次会话完成唤醒后才允许清理，避免旧任务污染下一次会话。
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let _capture_guard = guard_state.lock()?;
    let state = app.state::<ScreenshotState>();
    if !state.is_generation_active(generation) {
        return Ok(());
    }
    let capture_path = pending_file.retain();
    *state.screen_data.lock().unwrap() = Some(ScreenshotCapture {
        generation,
        mode: if mode.as_deref() == Some("longshot") {
            "longshot".to_string()
        } else {
            "normal".to_string()
        },
        path: capture_path.to_string_lossy().into_owned(),
    });
    // 关闭“截图前最小化”后，必须等画面已捕获才隐藏主窗口：
    // 截图数据仍包含当前工具，而后续全屏截图窗口可独占前台与输入。
    if mode.as_deref() != Some("longshot") && !should_minimize_before_capture(&app) {
        // 图片解码和首帧提交会自然跨过系统合成周期，无需再固定等待 100ms。
        hide_main_after_capture(&app);
    }

    ensure_screenshot_window(&app)?;
    let window = app
        .get_webview_window("screenshot")
        .ok_or_else(|| "截图窗口不存在".to_string())?;
    window
        .emit(
            "screenshot-capture-ready",
            ScreenshotCaptureReady { generation },
        )
        .map_err(|e| format!("通知截图窗口失败: {e}"))?;
    Ok(())
}

/// 创建并预热可跨会话复用的隐藏截图窗口。
pub fn ensure_screenshot_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("screenshot").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
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
    .map_err(|e| format!("预热截图窗口失败: {e}"))?;
    Ok(())
}

/// 获取已捕获的屏幕截图；预热阶段尚无数据时返回空。
#[tauri::command]
pub fn get_screen_capture(app: AppHandle) -> Option<ScreenshotCapture> {
    let state = app.state::<ScreenshotState>();
    let data = state.screen_data.lock().unwrap();
    data.clone()
}

/// 将 base64 PNG 图片写入系统剪贴板
#[tauri::command]
pub fn copy_image_to_clipboard(app: AppHandle, base64_data: String) -> Result<(), String> {
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
    // 剪贴板历史监控与截图复制共享系统剪贴板句柄。使用同一把锁，避免录屏打开时
    // 后台监控恰好持有句柄导致截图确认复制失败。
    let state = app.state::<crate::clipboard::ClipboardHistoryState>();
    let _guard = state
        .clipboard_lock
        .lock()
        .map_err(|_| "剪贴板锁不可用".to_string())?;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .set_image(img_data)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    Ok(())
}

/// 弹出保存对话框，将 base64 图片保存到文件并返回实际路径
#[tauri::command]
pub fn save_image_dialog(
    app: AppHandle,
    base64_data: String,
    format: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("解码 base64 失败: {e}"))?;

    let format = format.as_deref().unwrap_or("png");
    let (filter_name, extensions, default_extension) = match format {
        "jpeg" => ("JPEG 图片", &["jpg", "jpeg"][..], "jpg"),
        "webp" => ("WebP 图片", &["webp"][..], "webp"),
        _ => ("PNG 图片", &["png"][..], "png"),
    };
    // 截图窗口是全屏置顶且会拦截鼠标。必须先隐藏它，原生保存对话框才能接收输入。
    if let Some(window) = app.get_webview_window("screenshot") {
        let _ = window.hide();
    }
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

/// 隐藏并复位截图窗口，保留 WebView 供下一次快捷键复用。
#[tauri::command]
pub fn close_screenshot_window(app: AppHandle, generation: Option<u64>) -> Result<(), String> {
    close_screenshot_window_inner(&app, generation)
}

/// 仅取消触发 Esc 时仍在运行的同一截图会话，防止延迟回调误关下一次框选。
pub fn close_screenshot_generation(app: AppHandle, generation: u64) -> Result<(), String> {
    close_screenshot_window_inner(&app, Some(generation))
}

fn close_screenshot_window_inner(
    app: &AppHandle,
    expected_generation: Option<u64>,
) -> Result<(), String> {
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let _capture_guard = guard_state.lock()?;
    let state = app.state::<ScreenshotState>();
    if expected_generation.is_some_and(|generation| !state.is_generation_active(generation)) {
        return Ok(());
    }
    let hide_result = if let Some(win) = app.get_webview_window("screenshot") {
        win.hide().map_err(|error| format!("隐藏窗口失败: {error}"))
    } else {
        Ok(())
    };

    {
        state.release_current();
    }
    unregister_screenshot_esc(app);
    restore_main_after_screenshot(app);
    hide_result
}

fn cleanup_unready_screenshot_generation(app: &AppHandle, generation: u64) {
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let Ok(_capture_guard) = guard_state.lock() else {
        return;
    };
    let state = app.state::<ScreenshotState>();
    if !state.should_cleanup(generation) {
        return;
    }
    if let Some(window) = app.get_webview_window("screenshot") {
        let _ = window.hide();
    }
    state.release_if_generation(generation);
    unregister_screenshot_esc(app);
    restore_main_after_screenshot(app);
}

/// 在指定位置（主显示器 CSS 像素坐标）发送滚轮向下事件，用于长截图自动滚动。
/// Windows 将滚轮路由到光标下的窗口，因此发送前先把光标移到该位置。
#[tauri::command]
pub fn send_scroll_wheel(app: AppHandle, x: f64, y: f64, notches: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
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
pub async fn capture_screen_region(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
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
        let cropped = image::imageops::crop_imm(
            &image,
            cx as u32,
            cy as u32,
            (cx2 - cx) as u32,
            (cy2 - cy) as u32,
        )
        .to_image();

        // 缩放回 CSS 像素尺寸，与前端坐标约定保持一致
        let out_w = ((cx2 - cx) as f64 / scale).round().max(1.0) as u32;
        let out_h = ((cy2 - cy) as f64 / scale).round().max(1.0) as u32;
        let resized = if (scale - 1.0).abs() > 0.01 {
            image::imageops::resize(
                &cropped,
                out_w,
                out_h,
                image::imageops::FilterType::Lanczos3,
            )
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
    // 长截图面板与录屏的检查、建窗必须串行；已有会话时安全忽略重复入口。
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let _capture_guard = guard_state.lock()?;
    if crate::recorder::active_session_id(&app).is_some()
        || app.get_webview_window("longshot-panel").is_some()
    {
        return Ok(());
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

/// 前端截图覆盖层提交后显示并聚焦预热窗口。
#[tauri::command]
pub fn show_screenshot_window(app: AppHandle, generation: u64) -> Result<(), String> {
    let guard_state = app.state::<crate::capture_guard::CaptureGuardState>();
    let _capture_guard = guard_state.lock()?;
    let state = app.state::<ScreenshotState>();
    if !state.is_generation_active(generation) {
        return Ok(());
    }
    let win = app
        .get_webview_window("screenshot")
        .ok_or_else(|| "截图窗口不存在".to_string())?;
    // 前端确认首帧已提交后再全屏、显示和聚焦。
    if !win
        .is_fullscreen()
        .map_err(|e| format!("读取全屏状态失败: {e}"))?
    {
        win.set_fullscreen(true)
            .map_err(|e| format!("全屏失败: {e}"))?;
    }
    win.show().map_err(|e| format!("显示窗口失败: {e}"))?;
    win.set_focus().map_err(|e| format!("聚焦窗口失败: {e}"))?;
    state.mark_current_ready();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_screenshot_esc, PendingScreenshotFile, ScreenshotState};
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn screenshot_escape_is_recognized() {
        let escape = "Esc".parse::<Shortcut>().expect("Esc 应可解析");
        let other = "Ctrl+A".parse::<Shortcut>().expect("普通快捷键应可解析");

        assert!(is_screenshot_esc(&escape));
        assert!(!is_screenshot_esc(&other));
    }

    #[test]
    fn screenshot_minimization_setting_can_be_disabled() {
        let state = ScreenshotState::default();

        assert!(state.settings().minimize_before_capture);
        state.set_minimize_before_capture(false);
        assert!(!state.settings().minimize_before_capture);
    }

    #[test]
    fn main_window_restore_request_is_consumed_once() {
        let state = ScreenshotState::default();

        state.mark_main_hidden_for_screenshot();
        assert!(state.take_main_restore_request());
        assert!(!state.take_main_restore_request());
    }

    #[test]
    fn screenshot_session_stays_active_until_released() {
        let state = ScreenshotState::default();
        let generation = state.try_begin_session().expect("首次会话应成功开始");

        assert!(state.is_active());
        assert!(state.try_begin_session().is_none());

        state.release_if_generation(generation);
        assert!(!state.is_active());
        assert!(state.try_begin_session().is_some());
    }

    #[test]
    fn stale_watchdog_cannot_release_a_new_session() {
        let state = ScreenshotState::default();
        let old_generation = state.try_begin_session().expect("首次会话应成功开始");
        state.release_if_generation(old_generation);
        let new_generation = state.try_begin_session().expect("新会话应成功开始");

        state.release_if_generation(old_generation);

        assert!(state.is_active());
        assert_ne!(old_generation, new_generation);
    }

    #[test]
    fn main_window_restore_requests_keep_their_target_state() {
        let state = ScreenshotState::default();

        state.mark_main_hidden_as_minimized();
        assert!(state.take_main_minimized_request());
        assert!(!state.take_main_minimized_request());
        assert!(!state.take_main_restore_request());

        state.mark_main_hidden_for_screenshot();
        assert!(!state.take_main_minimized_request());
        assert!(state.take_main_restore_request());
        assert!(!state.take_main_restore_request());
    }

    #[test]
    fn pending_screenshot_file_is_removed_unless_retained() {
        let path = std::env::temp_dir().join(format!(
            "niuery-pending-screenshot-{}.png",
            std::process::id()
        ));
        std::fs::write(&path, b"partial").expect("应能创建待清理截图缓存");

        {
            let _pending = PendingScreenshotFile::new(path.clone());
        }

        assert!(!path.exists(), "未登记的截图缓存必须自动清理");
    }
}
