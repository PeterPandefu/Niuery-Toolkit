use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "append_local_file";
const MAX_BYTES: u64 = 1024 * 1024;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "向用户本机上已存在的纯文本／代码文件末尾追加文本（UTF-8）。追加后总大小不能超过 1 MiB。每次调用都需用户批准，批准前会展示完整绝对路径与当前文件大小。文件不存在时请先用 write_local_file 创建。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "已存在文件的绝对路径"
                },
                "content": {
                    "type": "string",
                    "description": "要追加到文件末尾的文本"
                }
            },
            "required": ["path", "content"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(false),
    }
}

pub async fn run(arguments: &Value) -> ToolOutcome {
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    let Some(content) = arguments.get("content").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 content 参数，或它不是字符串。");
    };
    let (canonical, size) = match file::resolve(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let total = size.saturating_add(content.len() as u64);
    if total > MAX_BYTES {
        return ToolOutcome::error("追加后超过 1 MiB 上限，已拒绝写入。");
    }
    if let Err(message) = super::super::validation::validate_text_payload(&name, total, content) {
        return ToolOutcome::error(message);
    }
    let data = content.to_string();
    let display = canonical.display().to_string();
    let appended = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().append(true).open(&canonical)?;
        file.write_all(data.as_bytes())
    })
    .await;
    match appended {
        Ok(Ok(())) => ToolOutcome::ok(format!(
            "已向 {display} 追加 {} 字节，现共 {total} 字节。",
            content.len()
        )),
        Ok(Err(_)) => ToolOutcome::error("追加文件失败，请检查权限或磁盘状态。"),
        Err(_) => ToolOutcome::error("追加文件失败。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-append-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[tokio::test]
    async fn ai_assistant_tools_append_extends_existing_text() {
        let path = temp_file("log.txt", b"line1\n");
        let outcome = run(&json!({ "path": path.to_str().unwrap(), "content": "line2\n" })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "line1\nline2\n");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_append_rejects_missing_binary_and_oversize() {
        let missing = std::env::temp_dir().join(format!("absent-{}.txt", nanoid::nanoid!()));
        let outcome = run(&json!({ "path": missing.to_str().unwrap(), "content": "x" })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不存在"));
        assert!(
            run(&json!({ "path": "relative.txt", "content": "x" }))
                .await
                .is_error
        );
        assert!(run(&json!({ "content": "x" })).await.is_error);

        let binary = temp_file("data.bin", b"abc");
        assert!(
            run(&json!({ "path": binary.to_str().unwrap(), "content": "x" }))
                .await
                .is_error
        );
        std::fs::remove_dir_all(binary.parent().unwrap()).unwrap();

        let big = temp_file("big.txt", &vec![b'a'; MAX_BYTES as usize]);
        let outcome = run(&json!({ "path": big.to_str().unwrap(), "content": "x" })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("1 MiB"));
        std::fs::remove_dir_all(big.parent().unwrap()).unwrap();
    }
}
