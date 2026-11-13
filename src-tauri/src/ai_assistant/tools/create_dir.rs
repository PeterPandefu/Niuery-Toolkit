use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use crate::resources::install::reject_links;
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::Path;

pub const NAME: &str = "create_directory";
const LINK_REFUSED: &str = "路径包含符号链接或重解析点，已拒绝创建。";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "在用户本机创建一个目录（可递归创建缺失的父目录）。目录已存在时直接返回成功。每次调用都需用户批准，批准前会展示完整绝对路径。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目录的绝对路径，例如 C:/Users/me/Desktop/new-folder"
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(false),
    }
}

pub fn resolve(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空。".into());
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err("只接受绝对路径。".into());
    }
    reject_links(candidate).map_err(|_| LINK_REFUSED.to_string())?;
    if candidate.exists() && !candidate.is_dir() {
        return Err("目标已存在且不是目录。".into());
    }
    Ok(candidate.to_path_buf())
}

pub async fn run(arguments: &Value) -> ToolOutcome {
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    let target = match resolve(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let display = target.display().to_string();
    let existed = target.is_dir();
    let created = tokio::task::spawn_blocking(move || std::fs::create_dir_all(&target)).await;
    match created {
        Ok(Ok(())) => ToolOutcome::ok(if existed {
            format!("目录已存在：{display}")
        } else {
            format!("已创建目录：{display}")
        }),
        Ok(Err(_)) => ToolOutcome::error("创建目录失败，请检查权限或磁盘状态。"),
        Err(_) => ToolOutcome::error("创建目录失败。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ai_assistant_tools_create_dir_creates_nested_and_is_idempotent() {
        let root = std::env::temp_dir().join(format!("niuery-tool-mkdir-{}", nanoid::nanoid!()));
        let nested = root.join("a").join("b");
        let args = json!({ "path": nested.to_str().unwrap() });
        let outcome = run(&args).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(nested.is_dir());
        let again = run(&args).await;
        assert!(!again.is_error);
        assert!(again.content.contains("已存在"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_create_dir_rejects_files_and_relative_paths() {
        assert!(run(&json!({ "path": "relative/dir" })).await.is_error);
        assert!(run(&json!({ "path": "" })).await.is_error);
        assert!(run(&json!({})).await.is_error);
        let root = std::env::temp_dir().join(format!("niuery-tool-mkdir-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let outcome = run(&json!({ "path": file.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不是目录"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
