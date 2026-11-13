use super::super::types::McpServer;
use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
pub const PREFIX: &str = "mcp__";

#[derive(Clone, Debug)]
pub struct McpToolDef {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

/// One connected stdio server. The catalog is read synchronously by the tool
/// registry; the connection itself is only touched under the async lock.
#[derive(Clone)]
pub struct McpEntry {
    pub server: String,
    pub tools: Vec<McpToolDef>,
    client: Arc<Mutex<McpClient>>,
}

struct McpClient {
    _child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
    next_id: u64,
}

pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    cleaned.trim_matches('_').to_string()
}

pub fn full_name(server: &str, tool: &str) -> String {
    format!("{PREFIX}{server}__{tool}")
}

/// Returns (server, tool) for a registered MCP tool name.
pub fn split_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix(PREFIX)?;
    let (server, tool) = rest.split_once("__")?;
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server, tool))
}

pub async fn discover(servers: &[McpServer]) -> Vec<McpEntry> {
    let mut entries = Vec::new();
    for server in servers.iter().filter(|server| server.enabled) {
        let label = sanitize(&server.name);
        if label.is_empty() {
            continue;
        }
        match connect(server, &label).await {
            Ok(entry) => entries.push(entry),
            // A broken server must not block the whole request; its tools
            // simply stay absent from the registry.
            Err(_) => continue,
        }
    }
    entries
}

async fn connect(server: &McpServer, label: &str) -> Result<McpEntry, String> {
    if server.command.trim().is_empty() {
        return Err("MCP 服务命令为空".into());
    }
    let mut command = tokio::process::Command::new(&server.command);
    command
        .args(&server.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "无法启动 MCP 服务进程")?;
    let stdin = child.stdin.take().ok_or("MCP 服务无输入通道")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("MCP 服务无输出通道")?);
    let mut client = McpClient {
        _child: child,
        stdin,
        stdout,
        next_id: 1,
    };
    let handshake = async {
        client
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "niuery-toolkit", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
            .await?;
        client
            .notify("notifications/initialized", json!({}))
            .await?;
        client.request("tools/list", json!({})).await
    };
    let listed = tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake)
        .await
        .map_err(|_| "MCP 握手超时".to_string())??;
    let mut tools = Vec::new();
    if let Some(list) = listed.get("tools").and_then(Value::as_array) {
        for item in list {
            let Some(name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            if name.contains("__") || sanitize(name) != name {
                continue;
            }
            tools.push(McpToolDef {
                name: name.to_string(),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                schema: item
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            });
        }
    }
    Ok(McpEntry {
        server: label.to_string(),
        tools,
        client: Arc::new(Mutex::new(client)),
    })
}

impl McpClient {
    async fn send(&mut self, message: Value) -> Result<(), String> {
        let mut line = message.to_string();
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|_| "MCP 服务输入通道已关闭".to_string())?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "MCP 服务输入通道已关闭".to_string())
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        loop {
            let mut line = String::new();
            let read = tokio::time::timeout(CALL_TIMEOUT, self.stdout.read_line(&mut line))
                .await
                .map_err(|_| "MCP 服务响应超时".to_string())?
                .map_err(|_| "MCP 服务输出通道读取失败".to_string())?;
            if read == 0 {
                return Err("MCP 服务已退出".into());
            }
            if line.len() > MAX_LINE_BYTES {
                return Err("MCP 服务响应过大".into());
            }
            let Ok(parsed) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if parsed.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = parsed.get("error") {
                return Err(format!("MCP 服务返回错误：{error}"));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

pub fn specs(entries: &[McpEntry]) -> Vec<ToolSpec> {
    let mut specs = Vec::new();
    for entry in entries {
        for tool in &entry.tools {
            specs.push(ToolSpec {
                name: full_name(&entry.server, &tool.name),
                description: format!(
                    "[MCP:{}] {}",
                    entry.server,
                    if tool.description.is_empty() {
                        "（服务未提供描述）"
                    } else {
                        &tool.description
                    }
                ),
                parameters: tool.schema.clone(),
                approval: ApprovalLevel::Approve,
                annotations: ToolAnnotations::default()
                    .with_read_only(false)
                    .with_open_world(true),
            });
        }
    }
    specs
}

pub async fn call(entries: &[McpEntry], name: &str, arguments: &Value) -> ToolOutcome {
    let Some((server, tool)) = split_name(name) else {
        return ToolOutcome::error("MCP 工具名无效。");
    };
    let Some(entry) = entries.iter().find(|entry| entry.server == server) else {
        return ToolOutcome::error("MCP 服务未连接。");
    };
    if !entry.tools.iter().any(|item| item.name == tool) {
        return ToolOutcome::error("MCP 服务未提供该工具。");
    }
    let mut client = entry.client.lock().await;
    let result = client
        .request(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        )
        .await;
    let result = match result {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let mut text = String::new();
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        for item in content {
            if item.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(part) = item.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(part);
                }
            }
        }
    }
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if text.is_empty() {
        text = if is_error {
            "MCP 工具执行失败（未提供详情）。".to_string()
        } else {
            "MCP 工具执行完成（无文本输出）。".to_string()
        };
    }
    if is_error {
        ToolOutcome::error(text)
    } else {
        ToolOutcome::ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_assistant_tools_mcp_names_round_trip_and_sanitize() {
        assert_eq!(sanitize("my server-2"), "my_server_2");
        let full = full_name("demo", "read_data");
        assert_eq!(full, "mcp__demo__read_data");
        assert_eq!(split_name(&full), Some(("demo", "read_data")));
        assert_eq!(split_name("read_local_file"), None);
        assert_eq!(split_name("mcp____tool"), None);
    }

    #[tokio::test]
    async fn ai_assistant_tools_mcp_specs_are_gated_and_open_world() {
        let entry = McpEntry {
            server: "demo".into(),
            tools: vec![McpToolDef {
                name: "read_data".into(),
                description: "读取数据".into(),
                schema: json!({ "type": "object", "properties": {} }),
            }],
            client: Arc::new(Mutex::new(dummy_client())),
        };
        let specs = specs(&[entry]);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "mcp__demo__read_data");
        assert_eq!(specs[0].approval, ApprovalLevel::Approve);
        assert!(specs[0].annotations.open_world());
        assert!(specs[0].description.contains("MCP:demo"));
    }

    fn dummy_client() -> McpClient {
        // A never-spawned placeholder; tests here never touch the connection.
        let mut child = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        McpClient {
            _child: child,
            stdin,
            stdout,
            next_id: 1,
        }
    }

    #[tokio::test]
    async fn ai_assistant_tools_mcp_call_rejects_unknown_server_and_tool() {
        assert!(call(&[], "mcp__demo__x", &json!({})).await.is_error);
        assert!(call(&[], "not_mcp", &json!({})).await.is_error);
    }
}
