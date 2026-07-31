mod ws_server;

use ws_server::WsServerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(WsServerState::default())
        .invoke_handler(tauri::generate_handler![
            ws_server::start_ws_server,
            ws_server::stop_ws_server,
            ws_server::ws_broadcast,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
