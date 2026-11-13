use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "write_local_file";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "在用户本机创建或覆盖一个纯文本／代码文件（UTF-8，最多 1 MiB）。目标已存在时会整体覆盖。每次调用都需用户批准，批准前会展示完整绝对路径与写入大小。父目录必须已存在；不支持 PDF、Word 等文档。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "文件的绝对路径，例如 C:/Users/me/Desktop/notes.txt"
                },
                "content": {
                    "type": "string",
                    "description": "要写入的完整文本内容"
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
    let target = match file::resolve_target(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    if let Err(message) =
        super::super::validation::validate_text_payload(&name, content.len() as u64, content)
    {
        return ToolOutcome::error(message);
    }
    let data = content.to_string();
    let display = target.display().to_string();
    let written =
        tokio::task::spawn_blocking(move || std::fs::write(&target, data.as_bytes())).await;
    match written {
        Ok(Ok(())) => ToolOutcome::ok(format!("已写入 {display}（{} 字节）。", content.len())),
        Ok(Err(_)) => ToolOutcome::error("写入文件失败，请检查权限或磁盘状态。"),
        Err(_) => ToolOutcome::error("写入文件失败。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-write-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[tokio::test]
    async fn ai_assistant_tools_write_creates_and_overwrites_text() {
        let root = temp_root();
        let path = root.join("poem.txt");
        let args = json!({ "path": path.to_str().unwrap(), "content": "第一版" });
        let outcome = run(&args).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "第一版");
        let outcome = run(&json!({ "path": path.to_str().unwrap(), "content": "第二版" })).await;
        assert!(!outcome.is_error);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "第二版");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_write_rejects_bad_paths_and_payloads() {
        assert!(
            run(&json!({ "path": "relative.txt", "content": "x" }))
                .await
                .is_error
        );
        assert!(run(&json!({ "path": "", "content": "x" })).await.is_error);
        assert!(run(&json!({ "content": "x" })).await.is_error);
        assert!(
            run(&json!({ "path": "C:/absent-dir-xyz/a.txt" }))
                .await
                .is_error
        );
        let root = temp_root();
        let binary = root.join("image.png");
        let outcome = run(&json!({ "path": binary.to_str().unwrap(), "content": "x" })).await;
        assert!(outcome.is_error);
        let directory = json!({ "path": root.to_str().unwrap(), "content": "x" });
        assert!(run(&directory).await.is_error);
        let big = json!({ "path": root.join("big.txt").to_str().unwrap(), "content": "a".repeat(1024 * 1024 + 1) });
        assert!(run(&big).await.is_error);
        std::fs::remove_dir_all(root).unwrap();
    }
}
