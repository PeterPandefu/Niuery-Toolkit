use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

type WsSink = futures_util::stream::SplitSink<WebSocketStream<TcpStream>, Message>;

/// Shared state for WebSocket server
pub struct WsServerState {
    /// Shutdown signal senders keyed by server_id
    pub shutdowns: Mutex<HashMap<String, broadcast::Sender<()>>>,
    /// Connected client write halves keyed by client_id
    pub clients: Arc<Mutex<HashMap<String, WsSink>>>,
}

impl Default for WsServerState {
    fn default() -> Self {
        Self {
            shutdowns: Mutex::new(HashMap::new()),
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Serialize)]
struct ClientEvent {
    #[serde(rename = "clientId")]
    client_id: String,
}

#[derive(Clone, Serialize)]
struct MessageEvent {
    #[serde(rename = "clientId")]
    client_id: String,
    message: String,
}

#[tauri::command]
pub async fn start_ws_server(
    port: u16,
    app: AppHandle,
    state: State<'_, WsServerState>,
) -> Result<String, String> {
    let server_id = format!("ws-server-{}", port);

    // Check if already running
    {
        let shutdowns = state.shutdowns.lock().await;
        if shutdowns.contains_key(&server_id) {
            return Err(format!("Server already running on port {}", port));
        }
    }

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    // Create shutdown channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    // Store server
    {
        let mut shutdowns = state.shutdowns.lock().await;
        shutdowns.insert(server_id.clone(), shutdown_tx.clone());
    }

    let app_handle = app.clone();
    let clients_map = state.clients.clone();

    // Spawn server task
    tokio::spawn(async move {
        let mut client_counter: u64 = 0;
        let mut shutdown_rx = shutdown_tx.subscribe();

        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, addr)) => {
                            client_counter += 1;
                            let client_id = format!("client-{}", client_counter);
                            let app_clone = app_handle.clone();
                            let clients_clone = clients_map.clone();
                            let client_shutdown_rx = shutdown_tx.subscribe();

                            tokio::spawn(handle_connection(
                                stream,
                                addr,
                                client_id,
                                app_clone,
                                clients_clone,
                                client_shutdown_rx,
                            ));
                        }
                        Err(_) => break,
                    }
                }
                _ = shutdown_rx.recv() => {
                    break;
                }
            }
        }
    });

    Ok(server_id)
}

async fn handle_connection(
    stream: TcpStream,
    _addr: SocketAddr,
    client_id: String,
    app: AppHandle,
    clients: Arc<Mutex<HashMap<String, WsSink>>>,
    mut shutdown_rx: broadcast::Receiver<()>,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    // Notify frontend: client connected
    let _ = app.emit(
        "ws-client-connected",
        ClientEvent {
            client_id: client_id.clone(),
        },
    );

    let (write, mut read) = ws_stream.split();

    // Store write half for broadcasting
    {
        let mut map = clients.lock().await;
        map.insert(client_id.clone(), write);
    }

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let _ = app.emit(
                            "ws-message-received",
                            MessageEvent {
                                client_id: client_id.clone(),
                                message: text.to_string(),
                            },
                        );
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let _ = app.emit(
                            "ws-message-received",
                            MessageEvent {
                                client_id: client_id.clone(),
                                message: format!("[Binary {} bytes]", data.len()),
                            },
                        );
                    }
                    Some(Ok(Message::Ping(_))) => {
                        // Ping/Pong handled by tungstenite internally
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Err(_)) => {
                        break;
                    }
                    _ => {}
                }
            }
            _ = shutdown_rx.recv() => {
                break;
            }
        }
    }

    // Remove client from map
    {
        let mut map = clients.lock().await;
        map.remove(&client_id);
    }

    // Notify frontend: client disconnected
    let _ = app.emit(
        "ws-client-disconnected",
        ClientEvent {
            client_id: client_id.clone(),
        },
    );
}

#[tauri::command]
pub async fn stop_ws_server(state: State<'_, WsServerState>) -> Result<(), String> {
    // Send shutdown signal to all servers
    {
        let mut shutdowns = state.shutdowns.lock().await;
        for (_id, tx) in shutdowns.drain() {
            let _ = tx.send(());
        }
    }

    // Close all client connections
    {
        let mut clients = state.clients.lock().await;
        for (_id, mut sink) in clients.drain() {
            let _ = sink.send(Message::Close(None)).await;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ws_broadcast(
    message: String,
    state: State<'_, WsServerState>,
) -> Result<(), String> {
    let mut clients = state.clients.lock().await;

    for (_id, sink) in clients.iter_mut() {
        let _ = sink.send(Message::Text(message.clone().into())).await;
    }

    Ok(())
}
