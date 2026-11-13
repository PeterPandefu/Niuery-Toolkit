use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const NAME: &str = "run_command";
pub const OUTPUT_NAME: &str = "command_output";
pub const STOP_NAME: &str = "stop_command";
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 60;
const MAX_TIMEOUT_SECS: u64 = 300;

/// Background commands live only for the current generation task. Output is
/// drained into a capped buffer by a reader task, so polling never blocks.
#[derive(Clone, Default)]
pub struct CommandBoard {
    inner: Arc<Mutex<HashMap<u64, BackgroundCommand>>>,
}

struct BackgroundCommand {
    command: String,
    buffer: Arc<Mutex<String>>,
    finished: Arc<Mutex<Option<i32>>>,
    stop: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "在用户本机执行一条 shell 命令（Windows 用 cmd /C，其他平台用 sh -c），返回退出码与标准输出／错误输出（最多 64 KiB）。可指定工作目录与超时秒数（默认 60，最大 300）。这是高权限操作：每次调用都必须经用户批准，批准前会展示完整命令与工作目录。只执行完成当前任务所必需的命令；不要执行删除大量文件、修改系统配置或下载并运行可执行文件之类的危险命令。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的完整命令行" },
                "cwd": { "type": "string", "description": "可选：工作目录的绝对路径，必须已存在" },
                "timeout_secs": { "type": "integer", "minimum": 1, "maximum": 300, "description": "可选：超时秒数，默认 60" },
                "background": { "type": "boolean", "description": "可选：为 true 时立即返回进程编号，之后用 command_output 查看输出、stop_command 终止" }
            },
            "required": ["command"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(false),
    }
}

pub fn output_spec() -> ToolSpec {
    ToolSpec {
        name: OUTPUT_NAME.into(),
        description: "查看一个后台命令（run_command 以 background 启动）的当前状态与已捕获输出。只读，不终止进程。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer", "description": "run_command 返回的进程编号" }
            },
            "required": ["id"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(false),
    }
}

pub fn stop_spec() -> ToolSpec {
    ToolSpec {
        name: STOP_NAME.into(),
        description: "终止一个由 run_command 以 background 启动、仍在运行的命令。只能终止本次任务自己启动的进程。每次调用都需用户批准。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer", "description": "run_command 返回的进程编号" }
            },
            "required": ["id"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(false),
    }
}

pub async fn run_with_board(arguments: &Value, board: &CommandBoard) -> ToolOutcome {
    if arguments
        .get("background")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return spawn_background(arguments, board).await;
    }
    run(arguments).await
}

async fn spawn_background(arguments: &Value, board: &CommandBoard) -> ToolOutcome {
    let Some(command) = arguments.get("command").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 command 参数，或它不是字符串。");
    };
    if command.trim().is_empty() {
        return ToolOutcome::error("命令不能为空。");
    }
    let cwd = match arguments.get("cwd").and_then(Value::as_str) {
        Some(path) => match file::resolve_dir(path) {
            Ok(value) => Some(value),
            Err(message) => return ToolOutcome::error(message),
        },
        None => None,
    };
    let timeout_secs = arguments
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_TIMEOUT_SECS)
        .clamp(1, MAX_TIMEOUT_SECS);
    let mut process = if cfg!(windows) {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    } else {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    };
    if let Some(dir) = &cwd {
        process.current_dir(dir);
    }
    process
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = match process.spawn() {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("无法启动命令进程。"),
    };
    let buffer = Arc::new(Mutex::new(String::new()));
    let finished = Arc::new(Mutex::new(None::<i32>));
    if let Some(stdout) = child.stdout.take() {
        pump(stdout, buffer.clone(), "");
    }
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, buffer.clone(), "[stderr] ");
    }
    let child = Arc::new(tokio::sync::Mutex::new(Some(child)));
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let child = child.clone();
        let finished = finished.clone();
        let buffer = buffer.clone();
        tokio::spawn(async move {
            // One manager owns the child: natural exit, explicit stop and the
            // lifetime cap all resolve here, so no lock is held while waiting.
            let code = {
                let mut guard = child.lock().await;
                let Some(handle) = guard.as_mut() else {
                    return;
                };
                tokio::select! {
                    status = handle.wait() => status.ok().and_then(|value| value.code()),
                    _ = stop_rx => {
                        let _ = handle.kill().await;
                        let _ = handle.wait().await;
                        if let Ok(mut text) = buffer.lock() {
                            text.push_str("\n[已被 stop_command 终止]");
                        }
                        None
                    }
                    _ = tokio::time::sleep(Duration::from_secs(timeout_secs)) => {
                        let _ = handle.kill().await;
                        let _ = handle.wait().await;
                        if let Ok(mut text) = buffer.lock() {
                            text.push_str(&format!("\n[超过 {timeout_secs} 秒，已自动终止]"));
                        }
                        None
                    }
                }
            };
            if let Ok(mut slot) = finished.lock() {
                *slot = Some(code.unwrap_or(-1));
            }
            if let Ok(mut text) = buffer.lock() {
                text.push_str(&format!("\n[进程已结束，退出码 {}]", code.unwrap_or(-1)));
            }
        });
    }
    let Ok(mut entries) = board.inner.lock() else {
        return ToolOutcome::error("命令状态不可用。");
    };
    let id = entries.keys().max().copied().unwrap_or(0) + 1;
    entries.insert(
        id,
        BackgroundCommand {
            command: command.to_string(),
            buffer,
            finished,
            stop: Mutex::new(Some(stop_tx)),
        },
    );
    ToolOutcome::ok(format!(
        "后台命令 #{id} 已启动：{command}\n用 command_output 查看输出，stop_command 终止；最长运行 {timeout_secs} 秒。"
    ))
}

fn pump(
    stream: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    buffer: Arc<Mutex<String>>,
    prefix: &'static str,
) {
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(mut text) = buffer.lock() {
                if !prefix.is_empty() {
                    text.push_str(prefix);
                }
                text.push_str(&line);
                text.push('\n');
                if text.len() > MAX_OUTPUT_BYTES {
                    let cut = text.len() - MAX_OUTPUT_BYTES / 2;
                    text.drain(..cut);
                }
            }
        }
    });
}

pub async fn output(arguments: &Value, board: &CommandBoard) -> ToolOutcome {
    let Some(id) = arguments.get("id").and_then(Value::as_u64) else {
        return ToolOutcome::error("缺少 id 参数，或它不是整数。");
    };
    let Ok(entries) = board.inner.lock() else {
        return ToolOutcome::error("命令状态不可用。");
    };
    let Some(entry) = entries.get(&id) else {
        return ToolOutcome::error(format!("后台命令 #{id} 不存在。"));
    };
    let status = match entry.finished.lock().ok().and_then(|slot| *slot) {
        Some(code) => format!("已结束（退出码 {code}）"),
        None => "运行中".to_string(),
    };
    let text = entry
        .buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    ToolOutcome::ok(format!(
        "命令 #{id}：{}\n状态：{status}\n输出：\n{text}",
        entry.command
    ))
}

pub async fn stop(arguments: &Value, board: &CommandBoard) -> ToolOutcome {
    let Some(id) = arguments.get("id").and_then(Value::as_u64) else {
        return ToolOutcome::error("缺少 id 参数，或它不是整数。");
    };
    let stop_tx = {
        let Ok(entries) = board.inner.lock() else {
            return ToolOutcome::error("命令状态不可用。");
        };
        let Some(entry) = entries.get(&id) else {
            return ToolOutcome::error(format!("后台命令 #{id} 不存在。"));
        };
        if entry.finished.lock().is_ok_and(|slot| slot.is_some()) {
            return ToolOutcome::ok(format!("后台命令 #{id} 已结束，无需终止。"));
        }
        let Ok(mut slot) = entry.stop.lock() else {
            return ToolOutcome::error("命令状态不可用。");
        };
        slot.take()
    };
    match stop_tx {
        Some(tx) => {
            let _ = tx.send(());
            ToolOutcome::ok(format!("已终止后台命令 #{id}。"))
        }
        None => ToolOutcome::ok(format!("后台命令 #{id} 已在终止中。")),
    }
}

pub async fn run(arguments: &Value) -> ToolOutcome {
    let Some(command) = arguments.get("command").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 command 参数，或它不是字符串。");
    };
    if command.trim().is_empty() {
        return ToolOutcome::error("命令不能为空。");
    }
    let cwd = match arguments.get("cwd").and_then(Value::as_str) {
        Some(path) => match file::resolve_dir(path) {
            Ok(value) => Some(value),
            Err(message) => return ToolOutcome::error(message),
        },
        None => None,
    };
    let timeout_secs = arguments
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(1, MAX_TIMEOUT_SECS);

    let mut process = if cfg!(windows) {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    } else {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    };
    if let Some(dir) = &cwd {
        process.current_dir(dir);
    }
    process
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = match process.spawn() {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("无法启动命令进程。"),
    };
    let wait =
        tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await;
    let output = match wait {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => return ToolOutcome::error("等待命令结束失败。"),
        Err(_) => {
            return ToolOutcome::error(format!("命令执行超过 {timeout_secs} 秒，已终止。"));
        }
    };
    let code = output
        .status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "（被信号终止）".to_string());
    let stdout = capped_text(&output.stdout);
    let stderr = capped_text(&output.stderr);
    let mut text = format!("退出码：{code}");
    if !stdout.is_empty() {
        text.push_str(&format!("\n标准输出：\n{stdout}"));
    }
    if !stderr.is_empty() {
        text.push_str(&format!("\n标准错误：\n{stderr}"));
    }
    if output.status.success() {
        ToolOutcome::ok(text)
    } else {
        ToolOutcome {
            content: super::truncate(text),
            is_error: true,
            discovered_urls: Vec::new(),
        }
    }
}

fn capped_text(bytes: &[u8]) -> String {
    let kept = &bytes[..bytes.len().min(MAX_OUTPUT_BYTES)];
    let mut text = String::from_utf8_lossy(kept).into_owned();
    if bytes.len() > MAX_OUTPUT_BYTES {
        text.push_str("\n[输出已截断，仅保留前 64 KiB]");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ai_assistant_tools_command_runs_and_reports_output() {
        let command = if cfg!(windows) {
            "echo hello"
        } else {
            "echo hello"
        };
        let outcome = run(&json!({ "command": command })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("退出码：0"));
        assert!(outcome.content.contains("hello"));
    }

    #[tokio::test]
    async fn ai_assistant_tools_command_reports_failure_exit_code() {
        let command = if cfg!(windows) { "exit 3" } else { "exit 3" };
        let outcome = run(&json!({ "command": command })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("退出码：3"));
    }

    #[tokio::test]
    async fn ai_assistant_tools_command_validates_arguments() {
        assert!(run(&json!({})).await.is_error);
        assert!(run(&json!({ "command": "  " })).await.is_error);
        assert!(
            run(&json!({ "command": "echo x", "cwd": "relative/dir" }))
                .await
                .is_error
        );
        let missing = std::env::temp_dir().join(format!("absent-{}", nanoid::nanoid!()));
        assert!(
            run(&json!({ "command": "echo x", "cwd": missing.to_str().unwrap() }))
                .await
                .is_error
        );
    }

    #[tokio::test]
    async fn ai_assistant_tools_command_honors_cwd() {
        let root = std::env::temp_dir().join(format!("niuery-tool-cmd-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("marker.txt"), "m").unwrap();
        let command = if cfg!(windows) { "dir /b" } else { "ls" };
        let outcome = run(&json!({ "command": command, "cwd": root.to_str().unwrap() })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("marker.txt"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_command_background_runs_and_reports_output() {
        let board = CommandBoard::default();
        let outcome = run_with_board(
            &json!({ "command": "echo bg-hello", "background": true }),
            &board,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("#1"));
        let mut text = String::new();
        for _ in 0..100 {
            let out = output(&json!({ "id": 1 }), &board).await;
            assert!(!out.is_error);
            text = out.content;
            if text.contains("bg-hello") && text.contains("已结束") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(text.contains("bg-hello"), "{text}");
        assert!(text.contains("已结束"), "{text}");
        assert!(output(&json!({ "id": 99 }), &board).await.is_error);
    }

    #[tokio::test]
    async fn ai_assistant_tools_command_background_can_be_stopped() {
        let board = CommandBoard::default();
        let command = if cfg!(windows) {
            "ping -n 30 127.0.0.1"
        } else {
            "sleep 30"
        };
        let outcome =
            run_with_board(&json!({ "command": command, "background": true }), &board).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        let stopped = stop(&json!({ "id": 1 }), &board).await;
        assert!(!stopped.is_error, "{}", stopped.content);
        assert!(stopped.content.contains("已终止"));
        assert!(stop(&json!({ "id": 99 }), &board).await.is_error);
    }
}
