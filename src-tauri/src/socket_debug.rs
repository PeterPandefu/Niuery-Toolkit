use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

pub struct SocketDebugState {
    sessions: Mutex<HashMap<String, ActiveSession>>,
    next_session_id: AtomicU64,
}

impl Default for SocketDebugState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
        }
    }
}

enum ActiveSession {
    TcpClient {
        writer: mpsc::Sender<Vec<u8>>,
        stop: oneshot::Sender<()>,
    },
    TcpServer {
        clients: Arc<Mutex<HashMap<String, mpsc::Sender<Vec<u8>>>>>,
        stop: broadcast::Sender<()>,
    },
    Udp {
        socket: Arc<UdpSocket>,
        remote: Option<SocketAddr>,
        stop: oneshot::Sender<()>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketStartRequest {
    pub protocol: String,
    pub mode: String,
    pub host: String,
    pub port: u16,
    pub local_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketSendRequest {
    pub session_id: String,
    pub data: Vec<u8>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketSessionInfo {
    pub session_id: String,
    pub protocol: String,
    pub mode: String,
    pub local_address: Option<String>,
    pub remote_address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketStatusEvent {
    pub session_id: String,
    pub state: String,
    pub protocol: String,
    pub mode: String,
    pub local_address: Option<String>,
    pub remote_address: Option<String>,
    pub peer: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketDataEvent {
    pub session_id: String,
    pub direction: String,
    pub data: Vec<u8>,
    pub peer: Option<String>,
}

fn emit_status(
    app: &AppHandle,
    session_id: &str,
    state: &str,
    protocol: &str,
    mode: &str,
    local_address: Option<String>,
    remote_address: Option<String>,
    peer: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "socket-debug-status",
        SocketStatusEvent {
            session_id: session_id.to_string(),
            state: state.to_string(),
            protocol: protocol.to_string(),
            mode: mode.to_string(),
            local_address,
            remote_address,
            peer,
            error,
        },
    );
}

fn emit_data(
    app: &AppHandle,
    session_id: &str,
    direction: &str,
    data: Vec<u8>,
    peer: Option<String>,
) {
    let _ = app.emit(
        "socket-debug-data",
        SocketDataEvent {
            session_id: session_id.to_string(),
            direction: direction.to_string(),
            data,
            peer,
        },
    );
}

fn validate_protocol(protocol: &str) -> Result<(), String> {
    if matches!(protocol, "tcp" | "udp") {
        Ok(())
    } else {
        Err("仅支持 TCP 或 UDP 原生 Socket 连接".into())
    }
}

fn parse_bind_host(host: &str) -> &str {
    if host.trim().is_empty() {
        "0.0.0.0"
    } else {
        host.trim()
    }
}

fn format_socket_address(host: &str, port: u16) -> String {
    let host = host.trim();
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

async fn stop_session(session: ActiveSession) {
    match session {
        ActiveSession::TcpClient { stop, .. } => {
            let _ = stop.send(());
        }
        ActiveSession::TcpServer { stop, clients } => {
            let _ = stop.send(());
            clients.lock().await.clear();
        }
        ActiveSession::Udp { stop, .. } => {
            let _ = stop.send(());
        }
    }
}

async fn stop_current(state: &SocketDebugState, session_id: Option<&str>) {
    let sessions = {
        let mut sessions = state.sessions.lock().await;
        if let Some(session_id) = session_id {
            sessions.remove(session_id).into_iter().collect::<Vec<_>>()
        } else {
            sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        }
    };
    for session in sessions {
        stop_session(session).await;
    }
}

#[tauri::command]
pub async fn socket_debug_start(
    request: SocketStartRequest,
    app: AppHandle,
    state: State<'_, SocketDebugState>,
) -> Result<SocketSessionInfo, String> {
    validate_protocol(&request.protocol)?;
    if request.port == 0 {
        return Err("端口必须在 1 到 65535 之间".into());
    }
    let session_id = format!(
        "socket-{}",
        state.next_session_id.fetch_add(1, Ordering::Relaxed)
    );

    let is_server = request.mode == "server";
    if request.mode != "client" && !is_server {
        return Err("连接模式无效".into());
    }

    if request.protocol == "tcp" && is_server {
        let bind_addr = format_socket_address(parse_bind_host(&request.host), request.port);
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|error| format!("TCP 服务端启动失败：{error}"))?;
        let local_address = listener
            .local_addr()
            .ok()
            .map(|address| address.to_string());
        let (stop, mut stop_rx) = broadcast::channel::<()>(1);
        let clients = Arc::new(Mutex::new(HashMap::new()));
        let task_clients = clients.clone();
        let task_app = app.clone();
        let task_local_address = local_address.clone();
        let task_stop = stop.clone();
        let task_session_id = session_id.clone();
        tokio::spawn(async move {
            let mut counter = 0_u64;
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, peer)) = accepted else { break };
                        counter += 1;
                        let client_id = format!("{}#{}", peer, counter);
                        let (writer, writer_rx) = mpsc::channel::<Vec<u8>>(32);
                        task_clients.lock().await.insert(client_id.clone(), writer);
                        emit_status(&task_app, &task_session_id, "connected", "tcp", "server", task_local_address.clone(), None, Some(client_id.clone()), None);
                        let app_clone = task_app.clone();
                        let clients_clone = task_clients.clone();
                        let local = task_local_address.clone();
                        tokio::spawn(handle_tcp_connection(stream, writer_rx, task_stop.subscribe(), task_session_id.clone(), app_clone, clients_clone, client_id, local));
                    }
                    _ = stop_rx.recv() => break,
                }
            }
            emit_status(
                &task_app,
                &task_session_id,
                "disconnected",
                "tcp",
                "server",
                task_local_address,
                None,
                None,
                None,
            );
        });
        let info = SocketSessionInfo {
            session_id: session_id.clone(),
            protocol: "tcp".into(),
            mode: "server".into(),
            local_address,
            remote_address: None,
        };
        state.sessions.lock().await.insert(
            session_id.clone(),
            ActiveSession::TcpServer { clients, stop },
        );
        emit_status(
            &app,
            &session_id,
            "listening",
            "tcp",
            "server",
            info.local_address.clone(),
            None,
            None,
            None,
        );
        return Ok(info);
    }

    if request.protocol == "tcp" {
        let remote = format_socket_address(&request.host, request.port);
        let stream = TcpStream::connect(&remote)
            .await
            .map_err(|error| format!("TCP 连接失败：{error}"))?;
        let local_address = stream.local_addr().ok().map(|address| address.to_string());
        let remote_address = stream.peer_addr().ok().map(|address| address.to_string());
        let (reader, mut writer_stream) = stream.into_split();
        let (writer, mut writer_rx) = mpsc::channel::<Vec<u8>>(32);
        let (stop, mut stop_rx) = oneshot::channel();
        let task_app = app.clone();
        let local = local_address.clone();
        let remote_for_task = remote_address.clone();
        let task_session_id = session_id.clone();
        tokio::spawn(async move {
            let mut reader = reader;
            let mut buffer = vec![0_u8; 64 * 1024];
            loop {
                tokio::select! {
                    result = reader.read(&mut buffer) => {
                        match result {
                            Ok(0) => break,
                            Ok(size) => emit_data(&task_app, &task_session_id, "received", buffer[..size].to_vec(), remote_for_task.clone()),
                            Err(error) => {
                                emit_status(&task_app, &task_session_id, "error", "tcp", "client", local.clone(), remote_for_task.clone(), None, Some(error.to_string()));
                                break;
                            }
                        }
                    }
                    Some(data) = writer_rx.recv() => {
                        if let Err(error) = writer_stream.write_all(&data).await {
                            emit_status(&task_app, &task_session_id, "error", "tcp", "client", local.clone(), remote_for_task.clone(), None, Some(error.to_string()));
                            break;
                        }
                    }
                    _ = &mut stop_rx => break,
                }
            }
            let _ = writer_stream.shutdown().await;
            emit_status(
                &task_app,
                &task_session_id,
                "disconnected",
                "tcp",
                "client",
                local,
                remote_for_task,
                None,
                None,
            );
        });
        let info = SocketSessionInfo {
            session_id: session_id.clone(),
            protocol: "tcp".into(),
            mode: "client".into(),
            local_address,
            remote_address,
        };
        state.sessions.lock().await.insert(
            session_id.clone(),
            ActiveSession::TcpClient { writer, stop },
        );
        emit_status(
            &app,
            &session_id,
            "connected",
            "tcp",
            "client",
            info.local_address.clone(),
            info.remote_address.clone(),
            None,
            None,
        );
        return Ok(info);
    }

    let local_host = if is_server {
        parse_bind_host(&request.host)
    } else {
        "0.0.0.0"
    };
    let local_port = request
        .local_port
        .unwrap_or(if is_server { request.port } else { 0 });
    let socket = Arc::new(
        UdpSocket::bind(format_socket_address(local_host, local_port))
            .await
            .map_err(|error| format!("UDP 绑定失败：{error}"))?,
    );
    let local_address = socket.local_addr().ok().map(|address| address.to_string());
    let remote = if is_server {
        None
    } else {
        let target = format_socket_address(&request.host, request.port);
        let mut addresses = tokio::net::lookup_host(&target)
            .await
            .map_err(|error| format!("UDP 地址无效：{error}"))?;
        Some(
            addresses
                .next()
                .ok_or_else(|| "UDP 地址无效：没有可用地址".to_string())?,
        )
    };
    let (stop, mut stop_rx) = oneshot::channel();
    let task_app = app.clone();
    let task_socket = socket.clone();
    let task_local = local_address.clone();
    let task_remote = remote.as_ref().map(|address| address.to_string());
    let task_session_id = session_id.clone();
    tokio::spawn(async move {
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            tokio::select! {
                result = task_socket.recv_from(&mut buffer) => {
                    match result {
                        Ok((size, peer)) => emit_data(&task_app, &task_session_id, "received", buffer[..size].to_vec(), Some(peer.to_string())),
                        Err(error) => {
                            emit_status(&task_app, &task_session_id, "error", "udp", if task_remote.is_some() { "client" } else { "server" }, task_local.clone(), task_remote.clone(), None, Some(error.to_string()));
                            break;
                        }
                    }
                }
                _ = &mut stop_rx => break,
            }
        }
        emit_status(
            &task_app,
            &task_session_id,
            "disconnected",
            "udp",
            if task_remote.is_some() {
                "client"
            } else {
                "server"
            },
            task_local,
            task_remote,
            None,
            None,
        );
    });
    let info = SocketSessionInfo {
        session_id: session_id.clone(),
        protocol: "udp".into(),
        mode: if is_server {
            "server".into()
        } else {
            "client".into()
        },
        local_address,
        remote_address: remote.as_ref().map(|address| address.to_string()),
    };
    state.sessions.lock().await.insert(
        session_id.clone(),
        ActiveSession::Udp {
            socket,
            remote,
            stop,
        },
    );
    emit_status(
        &app,
        &session_id,
        if is_server { "listening" } else { "connected" },
        "udp",
        &info.mode,
        info.local_address.clone(),
        info.remote_address.clone(),
        None,
        None,
    );
    Ok(info)
}

async fn handle_tcp_connection(
    stream: TcpStream,
    mut writer_rx: mpsc::Receiver<Vec<u8>>,
    mut stop_rx: broadcast::Receiver<()>,
    session_id: String,
    app: AppHandle,
    clients: Arc<Mutex<HashMap<String, mpsc::Sender<Vec<u8>>>>>,
    client_id: String,
    local_address: Option<String>,
) {
    let peer = stream.peer_addr().ok().map(|address| address.to_string());
    let (mut reader, mut writer_stream) = stream.into_split();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        tokio::select! {
            result = reader.read(&mut buffer) => {
                match result {
                    Ok(0) => break,
                    Ok(size) => emit_data(&app, &session_id, "received", buffer[..size].to_vec(), peer.clone()),
                    Err(error) => {
                        emit_status(&app, &session_id, "error", "tcp", "server", local_address.clone(), None, Some(client_id.clone()), Some(error.to_string()));
                        break;
                    }
                }
            }
            Some(data) = writer_rx.recv() => {
                if let Err(error) = writer_stream.write_all(&data).await {
                    emit_status(&app, &session_id, "error", "tcp", "server", local_address.clone(), None, Some(client_id.clone()), Some(error.to_string()));
                    break;
                }
            }
            _ = stop_rx.recv() => break,
        }
    }
    clients.lock().await.remove(&client_id);
    emit_status(
        &app,
        &session_id,
        "disconnected",
        "tcp",
        "server",
        local_address,
        None,
        Some(client_id),
        None,
    );
}

#[tauri::command]
pub async fn socket_debug_send(
    request: SocketSendRequest,
    state: State<'_, SocketDebugState>,
) -> Result<(), String> {
    if request.data.is_empty() {
        return Err("发送内容不能为空".into());
    }
    let sessions = state.sessions.lock().await;
    match sessions.get(&request.session_id) {
        Some(ActiveSession::TcpClient { writer, .. }) => writer
            .send(request.data)
            .await
            .map_err(|_| "TCP 连接已断开".into()),
        Some(ActiveSession::TcpServer { clients, .. }) => {
            let clients = clients.lock().await;
            if let Some(target) = request.target {
                let writer = clients
                    .get(&target)
                    .ok_or_else(|| "目标客户端已断开".to_string())?;
                writer
                    .send(request.data)
                    .await
                    .map_err(|_| "目标客户端已断开".into())
            } else {
                for writer in clients.values() {
                    let _ = writer.send(request.data.clone()).await;
                }
                Ok(())
            }
        }
        Some(ActiveSession::Udp { socket, remote, .. }) => {
            let target = request
                .target
                .or_else(|| remote.map(|address| address.to_string()))
                .ok_or_else(|| "UDP 服务端需要指定目标地址".to_string())?;
            let address = target
                .parse::<SocketAddr>()
                .map_err(|error| format!("目标地址无效：{error}"))?;
            socket
                .send_to(&request.data, address)
                .await
                .map_err(|error| format!("UDP 发送失败：{error}"))?;
            Ok(())
        }
        None => Err("当前没有活动连接".into()),
    }
}

#[tauri::command]
pub async fn socket_debug_stop(
    session_id: Option<String>,
    state: State<'_, SocketDebugState>,
) -> Result<(), String> {
    stop_current(&state, session_id.as_deref()).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{format_socket_address, parse_bind_host, validate_protocol};

    #[test]
    fn formats_ipv4_and_ipv6_socket_addresses() {
        assert_eq!(format_socket_address("127.0.0.1", 9000), "127.0.0.1:9000");
        assert_eq!(format_socket_address("::1", 9000), "[::1]:9000");
        assert_eq!(format_socket_address("[::1]", 9000), "[::1]:9000");
    }

    #[test]
    fn defaults_empty_bind_host_to_all_ipv4_interfaces() {
        assert_eq!(parse_bind_host(""), "0.0.0.0");
        assert_eq!(parse_bind_host("  "), "0.0.0.0");
        assert_eq!(parse_bind_host("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn only_accepts_native_socket_protocols() {
        assert!(validate_protocol("tcp").is_ok());
        assert!(validate_protocol("udp").is_ok());
        assert!(validate_protocol("websocket").is_err());
    }
}
