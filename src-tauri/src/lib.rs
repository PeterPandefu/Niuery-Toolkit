mod screenshot;
mod ws_server;

use screenshot::ScreenshotState;
use tauri::image::Image;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use ws_server::WsServerState;

/// 关闭行为配置
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct AppConfig {
    /// None = 未选择, Some(true) = 退出, Some(false) = 最小化到托盘
    close_to_exit: Option<bool>,
}

fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(AppConfig {
            close_to_exit: None,
        })
}

fn save_config(app: &tauri::AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(config).unwrap_or_default());
}

fn config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("settings.json")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 微信风格快捷键 Ctrl+Alt+A
    let screenshot_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &screenshot_shortcut && event.state() == ShortcutState::Pressed {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = screenshot::start_screenshot(app).await;
                        });
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
        .invoke_handler(tauri::generate_handler![
            ws_server::start_ws_server,
            ws_server::stop_ws_server,
            ws_server::ws_broadcast,
            screenshot::start_screenshot,
            screenshot::get_screen_capture,
            screenshot::copy_image_to_clipboard,
            screenshot::save_image_dialog,
            screenshot::close_screenshot_window,
        ])
        .setup(move |app| {
            app.global_shortcut()
                .register(screenshot_shortcut)
                .expect("注册全局快捷键失败");

            // 加载托盘图标
            let tray_icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("加载托盘图标失败");

            // 构建托盘菜单
            let autostart_item = CheckMenuItemBuilder::with_id("autostart", "开机自启动")
                .checked(false)
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
                let app = window.app_handle();
                let config = load_config(app);

                match config.close_to_exit {
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
                                let mut cfg = load_config(&app_handle);
                                cfg.close_to_exit = Some(exit);
                                save_config(&app_handle, &cfg);

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
