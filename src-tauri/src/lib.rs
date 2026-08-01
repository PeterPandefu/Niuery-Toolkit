mod screenshot;
mod ws_server;

use screenshot::ScreenshotState;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use ws_server::WsServerState;

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
                        let _ = screenshot::start_screenshot(app.clone());
                    }
                })
                .build(),
        )
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
