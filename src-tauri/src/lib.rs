mod clipboard;
mod hotkey;
pub mod recorder;
mod screenshot;
mod system_monitor;
mod ws_server;

/// 开发模式专用：独立启动（如开机自启动）时自动拉起前端 dev 服务
#[cfg(all(debug_assertions, windows))]
mod dev_server {
    use std::net::ToSocketAddrs;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::Manager;

    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    static SPAWNED_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

    fn pid_slot() -> &'static Mutex<Option<u32>> {
        SPAWNED_PID.get_or_init(|| Mutex::new(None))
    }

    fn probe(addr: &str) -> bool {
        addr.to_socket_addrs()
            .map(|mut addrs| {
                addrs
                    .any(|a| std::net::TcpStream::connect_timeout(&a, Duration::from_millis(500)).is_ok())
            })
            .unwrap_or(false)
    }

    /// 开发模式下若前端 dev 服务未运行，则后台拉起，并在就绪后让主窗口重新导航
    pub fn ensure(app: tauri::AppHandle) {
        let Some(url) = app.config().build.dev_url.clone() else {
            return;
        };
        let host = url.host_str().unwrap_or("localhost").to_string();
        let port = url.port_or_known_default().unwrap_or(21516);
        let addr = format!("{host}:{port}");
        if probe(&addr) {
            // dev 服务已在运行（正常 tauri dev 流程），无需处理
            return;
        }

        std::thread::spawn(move || {
            // 推导项目根目录：<root>/src-tauri/target/debug/<exe>
            let Some(root) = std::env::current_exe()
                .ok()
                .and_then(|p| p.ancestors().nth(4).map(|r| r.to_path_buf()))
            else {
                return;
            };

            if let Ok(child) = Command::new("cmd")
                .args(["/C", "npm", "run", "dev"])
                .current_dir(&root)
                .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
                .spawn()
            {
                *pid_slot().lock().unwrap() = Some(child.id());
            }

            // 等待服务就绪（最长约 60 秒）
            for _ in 0..120 {
                std::thread::sleep(Duration::from_millis(500));
                if probe(&addr) {
                    break;
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.navigate(url);
            }
        });
    }

    /// 进程退出时清理由本进程拉起的 dev 服务，避免残留
    pub fn kill_spawned() {
        if let Some(pid) = pid_slot().lock().unwrap().take() {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }
}

use clipboard::ClipboardHistoryState;
use hotkey::{HotkeyState, ACTION_LONGSHOT, ACTION_SCREENSHOT, ACTION_SCREEN_RECORDER, ACTION_SHOW_WINDOW};
use recorder::RecorderState;
use screenshot::ScreenshotState;
use system_monitor::SystemMonitorState;
use tauri::image::Image;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_global_shortcut::ShortcutState;
use ws_server::WsServerState;

/// 关闭行为状态（仅在本次运行期间有效，不持久化）
#[derive(Default)]
struct CloseBehaviorState(std::sync::Mutex<Option<bool>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // 动态查找快捷键对应的动作
                    if let Some(action) = hotkey::find_action(app, shortcut) {
                        match action.as_str() {
                            ACTION_SCREENSHOT => {
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = screenshot::start_screenshot(app, None).await;
                                });
                            }
                            ACTION_LONGSHOT => {
                                // 切换到截图编辑器工具，确保后续长截图事件能被监听
                                let _ = app.emit("open-longshot-editor", ());
                                // 主窗口可见时先最小化，避免遮挡待框选的内容
                                if let Some(window) = app.get_webview_window("main") {
                                    let visible = window.is_visible().unwrap_or(false);
                                    let minimized = window.is_minimized().unwrap_or(false);
                                    if visible && !minimized {
                                        let _ = window.minimize();
                                    }
                                }
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = screenshot::start_screenshot(app, Some("longshot".to_string())).await;
                                });
                            }
                            ACTION_SHOW_WINDOW => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            ACTION_SCREEN_RECORDER => {
                                if let Some(session_id) = recorder::active_session_id(app) {
                                    let app = app.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let _ = recorder::stop_recording(app, session_id).await;
                                    });
                                } else {
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                    }
                                    let _ = app.emit("open-screen-recorder", ());
                                }
                            }
                            _ => {}
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .manage(WsServerState::default())
        .manage(ScreenshotState::default())
        .manage(RecorderState::default())
        .manage(ClipboardHistoryState::default())
        .manage(SystemMonitorState::default())
        .manage(HotkeyState::default())
        .manage(CloseBehaviorState::default())
        .invoke_handler(tauri::generate_handler![
            ws_server::start_ws_server,
            ws_server::stop_ws_server,
            ws_server::ws_broadcast,
            screenshot::start_screenshot,
            screenshot::get_screen_capture,
            screenshot::copy_image_to_clipboard,
            screenshot::save_image_dialog,
            screenshot::close_screenshot_window,
            screenshot::show_screenshot_window,
            screenshot::capture_screen_region,
            screenshot::start_longshot_panel,
            screenshot::close_longshot_panel,
            recorder::list_capture_monitors,
            recorder::list_capture_windows,
            recorder::list_audio_sources,
            recorder::start_recording,
            recorder::pause_recording,
            recorder::resume_recording,
            recorder::stop_recording,
            recorder::cancel_recording,
            recorder::get_recording_preview,
            recorder::export_recording,
            recorder::prepare_gif_editor,
            clipboard::init_clipboard_history,
            clipboard::get_clipboard_history,
            clipboard::get_clipboard_image,
            clipboard::copy_text_to_clipboard,
            clipboard::copy_image_from_history,
            clipboard::copy_files_to_clipboard,
            clipboard::delete_clipboard_entry,
            clipboard::clear_clipboard_history,
            hotkey::update_hotkey,
            hotkey::get_hotkeys,
            hotkey::reset_hotkeys,
            system_monitor::get_system_stats,
        ])
        .setup(move |app| {
            // 开发模式下：开机自启动等独立启动场景自动拉起前端 dev 服务
            #[cfg(all(debug_assertions, windows))]
            dev_server::ensure(app.handle().clone());

            // 初始化剪贴板历史
            let app_handle = app.handle().clone();
            recorder::cleanup_stale_recordings(&app_handle);
            let _ = clipboard::init_clipboard_history(app_handle.clone());
            // 启动后台剪贴板监控
            clipboard::start_clipboard_monitor(app_handle);

            // 加载快捷键配置并注册
            let hotkey_bindings = hotkey::load_hotkey_bindings(app.handle());
            {
                let state = app.state::<HotkeyState>();
                let mut bindings = state.bindings.lock().unwrap();
                *bindings = hotkey_bindings;
            }
            hotkey::register_all(app.handle());

            // 加载托盘图标
            let tray_icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("加载托盘图标失败");

            // 构建托盘菜单（勾选状态与实际注册状态同步）
            let autostart_checked = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItemBuilder::with_id("autostart", "开机自启动")
                .checked(autostart_checked)
                .build(app)?;
            let restart_item = MenuItemBuilder::with_id("restart", "重启").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&autostart_item)
                .separator()
                .item(&restart_item)
                .item(&quit_item)
                .build()?;

            // 创建系统托盘图标
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Niuery Toolkit")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "autostart" => {
                        let autostart_mgr = app.autolaunch();
                        match autostart_mgr.is_enabled() {
                            Ok(true) => {
                                let _ = autostart_mgr.disable();
                                let _ = autostart_item.set_checked(false);
                            }
                            _ => {
                                let _ = autostart_mgr.enable();
                                let _ = autostart_item.set_checked(true);
                            }
                        }
                    }
                    "restart" => {
                        app.restart();
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 只对主窗口应用关闭拦截逻辑，截图窗口等其他窗口允许正常关闭
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let close_to_exit = {
                    let state = app.state::<CloseBehaviorState>();
                    let value = *state.0.lock().unwrap();
                    value
                };

                match close_to_exit {
                    Some(true) => {
                        // 用户选择了退出，不阻止关闭
                    }
                    Some(false) => {
                        // 最小化到托盘
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    None => {
                        // 首次关闭，弹窗询问
                        api.prevent_close();
                        let app_handle = app.clone();
                        app.dialog()
                            .message("关闭窗口时，您希望执行什么操作？")
                            .title("Niuery Toolkit")
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "退出程序".to_string(),
                                "最小化到托盘".to_string(),
                            ))
                            .show(move |exit| {
                                // 仅在本次运行期间记住选择，下次启动重新询问
                                {
                                    let state = app_handle.state::<CloseBehaviorState>();
                                    *state.0.lock().unwrap() = Some(exit);
                                }

                                if exit {
                                    app_handle.exit(0);
                                } else if let Some(win) = app_handle.get_webview_window("main") {
                                    let _ = win.hide();
                                }
                            });
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(all(debug_assertions, windows))]
                dev_server::kill_spawned();
            }
        });
}
