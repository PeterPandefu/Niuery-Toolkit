use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "edit_local_file";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "对一个已存在的纯文本／代码文件做精确字符串替换。old_string 必须与文件内容逐字符一致（含空白与换行）；默认要求它在文件中恰好出现一次，否则报错。设置 allow_multiple 为 true 时替换全部出现位置。每次调用都需用户批准，批准前会展示完整绝对路径与文件大小。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件的绝对路径" },
                "old_string": { "type": "string", "description": "要被替换的原文，必须与文件内容完全一致" },
                "new_string": { "type": "string", "description": "替换后的新文本，可以为空字符串（即删除）" },
                "allow_multiple": { "type": "boolean", "description": "为 true 时替换所有出现位置；默认 false，要求恰好出现一次" }
            },
            "required": ["path", "old_string", "new_string"],
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
    let Some(old_string) = arguments.get("old_string").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 old_string 参数，或它不是字符串。");
    };
    let Some(new_string) = arguments.get("new_string").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 new_string 参数，或它不是字符串。");
    };
    let allow_multiple = arguments
        .get("allow_multiple")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if old_string.is_empty() {
        return ToolOutcome::error("old_string 不能为空；新建或整体覆盖请使用 write_local_file。");
    }
    if old_string == new_string {
        return ToolOutcome::error("old_string 与 new_string 相同，无需修改。");
    }
    let (canonical, size) = match file::resolve(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let old = old_string.to_string();
    let new = new_string.to_string();
    let edited = tokio::task::spawn_blocking(move || -> Result<(String, usize), String> {
        let data = std::fs::read_to_string(&canonical).map_err(|_| "读取文件失败，可能不是 UTF-8 文本。".to_string())?;
        if let Err(message) =
            super::super::validation::validate_text_payload(&name, size, &data)
        {
            return Err(message);
        }
        let count = data.matches(&old).count();
        if count == 0 {
            return Err("old_string 在文件中不存在，未做任何修改。请重新读取文件确认原文。".into());
        }
        if count > 1 && !allow_multiple {
            return Err(format!(
                "old_string 在文件中出现 {count} 次；请提供更长的上下文使其唯一，或设置 allow_multiple 为 true。"
            ));
        }
        let updated = data.replace(&old, &new);
        if updated.len() > 1024 * 1024 {
            return Err("替换后内容超过 1 MiB，已拒绝写入。".into());
        }
        std::fs::write(&canonical, updated.as_bytes())
            .map_err(|_| "写入文件失败，请检查权限或磁盘状态。".to_string())?;
        Ok((canonical.display().to_string(), count))
    })
    .await;
    match edited {
        Ok(Ok((display, count))) => ToolOutcome::ok(format!("已编辑 {display}：替换 {count} 处。")),
        Ok(Err(message)) => ToolOutcome::error(message),
        Err(_) => ToolOutcome::error("编辑文件失败。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_file(contents: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-edit-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("code.rs");
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[tokio::test]
    async fn ai_assistant_tools_edit_replaces_unique_occurrence() {
        let path = temp_file("fn main() {\n    let a = 1;\n}\n");
        let outcome = run(&json!({
            "path": path.to_str().unwrap(),
            "old_string": "let a = 1;",
            "new_string": "let a = 2;"
        }))
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("let a = 2;"));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_edit_requires_unique_match_unless_allowed() {
        let path = temp_file("x\nx\n");
        let args = json!({ "path": path.to_str().unwrap(), "old_string": "x", "new_string": "y" });
        let outcome = run(&args).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("2 次"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "x\nx\n");
        let mut multi = args.clone();
        multi["allow_multiple"] = json!(true);
        let outcome = run(&multi).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "y\ny\n");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_edit_rejects_missing_and_invalid_arguments() {
        let path = temp_file("abc");
        let outcome = run(&json!({
            "path": path.to_str().unwrap(), "old_string": "zzz", "new_string": "y"
        }))
        .await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不存在"));
        assert!(
            run(&json!({ "path": path.to_str().unwrap(), "old_string": "", "new_string": "y" }))
                .await
                .is_error
        );
        assert!(
            run(
                &json!({ "path": path.to_str().unwrap(), "old_string": "abc", "new_string": "abc" })
            )
            .await
            .is_error
        );
        assert!(
            run(&json!({ "path": "relative.rs", "old_string": "a", "new_string": "b" }))
                .await
                .is_error
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
