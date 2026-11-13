use super::super::{engine::transport::GuardedHttp, validation};
use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use futures_util::{SinkExt, StreamExt};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const NAME: &str = "browse_page";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const PAGE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TEXT_CHARS: usize = 20_000;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "用内置无头浏览器真实渲染一个网页（执行 JavaScript），返回页面正文文本；可选同时截图保存到本机路径。适合 fetch_url 拿不到内容的动态页面。每次调用都需用户批准，批准前会展示原样 URL。只访问与当前任务直接相关的地址。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "完整的 HTTP/HTTPS 地址" },
                "screenshot_path": { "type": "string", "description": "可选：截图保存的绝对路径，扩展名须为 png，父目录必须已存在" }
            },
            "required": ["url"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(true),
    }
}

pub async fn run(arguments: &Value, chromium: Option<&Path>, http: &GuardedHttp) -> ToolOutcome {
    let Some(url) = arguments.get("url").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 url 参数，或它不是字符串。");
    };
    if let Err(message) = validation::validate_tool_url(url) {
        return ToolOutcome::error(message);
    }
    let screenshot = match arguments.get("screenshot_path").and_then(Value::as_str) {
        Some(path) => match file::resolve_target(path) {
            Ok(target)
                if target
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("png")) =>
            {
                Some(target)
            }
            Ok(_) => return ToolOutcome::error("截图路径扩展名必须是 png。"),
            Err(message) => return ToolOutcome::error(message),
        },
        None => None,
    };
    let Some(chromium) = chromium else {
        return ToolOutcome::error("内置 Chromium 不可用，请先在资源管理中准备浏览器组件。");
    };
    let outcome = tokio::time::timeout(
        STARTUP_TIMEOUT + PAGE_TIMEOUT + Duration::from_secs(15),
        browse(chromium, url, screenshot.as_deref(), http),
    )
    .await;
    match outcome {
        Ok(result) => result,
        Err(_) => ToolOutcome::error("浏览器渲染超时，已终止。"),
    }
}

async fn browse(
    chromium: &Path,
    url: &str,
    screenshot: Option<&Path>,
    http: &GuardedHttp,
) -> ToolOutcome {
    let _lease = match crate::resources::lease("chromium") {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let base = std::env::temp_dir().join(format!("niuery-ai-browse-{}", nanoid::nanoid!()));
    if let Err(message) = tokio::fs::create_dir_all(&base)
        .await
        .map_err(|e| e.to_string())
    {
        return ToolOutcome::error(message);
    }
    let mut command = tokio::process::Command::new(chromium);
    command
        .arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--no-proxy-server")
        .arg("--disable-extensions")
        .arg("--disable-background-networking")
        .arg("--disable-component-update")
        .arg("--disable-sync")
        .arg("--no-first-run")
        .arg("--remote-debugging-port=0")
        .arg(format!(
            "--user-data-dir={}",
            base.join("profile").display()
        ))
        .arg("about:blank")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match command.spawn() {
        Ok(value) => value,
        Err(_) => {
            let _ = tokio::fs::remove_dir_all(&base).await;
            return ToolOutcome::error("启动内置浏览器失败。");
        }
    };
    let result = drive(&base, url, screenshot, http).await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    let _ = tokio::fs::remove_dir_all(&base).await;
    result
}

async fn drive(
    base: &Path,
    url: &str,
    screenshot: Option<&Path>,
    http: &GuardedHttp,
) -> ToolOutcome {
    let port = match wait_for_port(base).await {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let list_url = format!("http://127.0.0.1:{port}/json/list");
    let response = match http.get_capped(&list_url, 1024 * 1024).await {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    let targets: Value = match serde_json::from_slice(&response.body) {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("无法读取浏览器调试目标。"),
    };
    let ws_url = targets
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|target| target.get("type").and_then(Value::as_str) == Some("page"))
        })
        .and_then(|target| target.get("webSocketDebuggerUrl"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let Some(ws_url) = ws_url else {
        return ToolOutcome::error("浏览器未提供页面调试通道。");
    };
    let (mut socket, _) = match tokio_tungstenite::connect_async(&ws_url).await {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("连接浏览器调试通道失败。"),
    };
    let mut next_id = 1u64;
    macro_rules! call {
        ($method:expr, $params:expr) => {{
            let id = next_id;
            next_id += 1;
            let message = json!({ "id": id, "method": $method, "params": $params });
            if socket
                .send(tokio_tungstenite::tungstenite::Message::text(message.to_string()))
                .await
                .is_err()
            {
                return ToolOutcome::error("浏览器调试通道已断开。");
            }
            match wait_response(&mut socket, id, None).await {
                Ok(value) => value,
                Err(message) => return ToolOutcome::error(message),
            }
        }};
    }
    call!("Page.enable", json!({}));
    call!("Page.navigate", json!({ "url": url }));
    if let Err(message) = wait_load(&mut socket).await {
        return ToolOutcome::error(message);
    }
    let evaluated = call!(
        "Runtime.evaluate",
        json!({
            "expression": "document.body ? document.body.innerText : ''",
            "returnByValue": true
        })
    );
    let text = evaluated
        .pointer("/result/value")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut content: String = text.chars().take(MAX_TEXT_CHARS).collect();
    if text.chars().count() > MAX_TEXT_CHARS {
        content.push_str("\n[正文已截断]");
    }
    if let Some(target) = screenshot {
        let captured = call!("Page.captureScreenshot", json!({ "format": "png" }));
        let Some(encoded) = captured.get("data").and_then(Value::as_str) else {
            return ToolOutcome::error("浏览器截图失败。");
        };
        use base64::Engine;
        let bytes = match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(value) => value,
            Err(_) => return ToolOutcome::error("截图数据编码无效。"),
        };
        let target = target.to_path_buf();
        if tokio::fs::write(&target, &bytes).await.is_err() {
            return ToolOutcome::error("写入截图失败，请检查权限或磁盘状态。");
        }
        content.push_str(&format!(
            "\n截图已保存到 {}（{} 字节）。",
            target.display(),
            bytes.len()
        ));
    }
    if content.trim().is_empty() {
        content = "页面未返回正文文本。".to_string();
    }
    ToolOutcome::ok(content)
}

async fn wait_for_port(base: &Path) -> Result<u16, String> {
    let path = base.join("profile").join("DevToolsActivePort");
    let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
    loop {
        if let Ok(contents) = tokio::fs::read_to_string(&path).await {
            if let Some(port) = contents
                .lines()
                .next()
                .and_then(|line| line.trim().parse::<u16>().ok())
            {
                return Ok(port);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("浏览器调试端口启动超时。".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn wait_response(socket: &mut Socket, id: u64, _unused: Option<()>) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + PAGE_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let message = tokio::time::timeout(remaining, socket.next())
            .await
            .map_err(|_| "等待浏览器响应超时。".to_string())?;
        let Some(message) = message else {
            return Err("浏览器调试通道已关闭。".into());
        };
        let message = message.map_err(|_| "浏览器调试通道读取失败。".to_string())?;
        let text = match message {
            tokio_tungstenite::tungstenite::Message::Text(text) => text,
            _ => continue,
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if parsed.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(error) = parsed.get("error") {
                return Err(format!("浏览器操作失败：{error}"));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

async fn wait_load(socket: &mut Socket) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + PAGE_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let message = tokio::time::timeout(remaining, socket.next())
            .await
            .map_err(|_| "等待页面加载超时。".to_string())?;
        let Some(message) = message else {
            return Err("浏览器调试通道已关闭。".into());
        };
        let message = message.map_err(|_| "浏览器调试通道读取失败。".to_string())?;
        let text = match message {
            tokio_tungstenite::tungstenite::Message::Text(text) => text,
            _ => continue,
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        match parsed.get("method").and_then(Value::as_str) {
            Some("Page.loadEventFired") | Some("Page.frameStoppedLoading") => return Ok(()),
            _ => continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ai_assistant_tools_browser_validates_before_launch() {
        let http = GuardedHttp::for_tools().unwrap();
        assert!(run(&json!({}), None, &http).await.is_error);
        assert!(
            run(&json!({ "url": "javascript:alert(1)" }), None, &http)
                .await
                .is_error
        );
        let outcome = run(&json!({ "url": "https://example.com" }), None, &http).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("Chromium"));
        assert!(
            run(
                &json!({ "url": "https://example.com", "screenshot_path": "relative.png" }),
                None,
                &http
            )
            .await
            .is_error
        );
    }

    #[test]
    fn ai_assistant_tools_browser_spec_is_open_world_and_gated() {
        let spec = spec();
        assert_eq!(spec.approval, ApprovalLevel::Approve);
        assert!(spec.annotations.open_world());
    }
}
