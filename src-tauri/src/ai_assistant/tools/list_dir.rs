use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "list_directory";
const MAX_ENTRIES: usize = 200;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "列出用户本机上某个目录的直接子项（名称、类型、文件大小），不递归。最多返回 200 条。每次调用都需用户批准，批准前会展示完整绝对路径。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目录的绝对路径，例如 C:/Users/me/Desktop"
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(false),
    }
}

pub async fn run(arguments: &Value) -> ToolOutcome {
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    let canonical = match file::resolve_dir(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let display = canonical.display().to_string();
    let listed = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut entries = Vec::new();
        let mut total = 0usize;
        for entry in std::fs::read_dir(&canonical).map_err(|_| "无法读取目录。".to_string())?
        {
            total += 1;
            let entry = match entry {
                Ok(value) => value,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => {
                    entries.push((1, format!("{name}\t[无法读取]")));
                    continue;
                }
            };
            let line = if metadata.is_dir() {
                (0, format!("{name}\t目录"))
            } else if metadata.is_file() {
                (1, format!("{name}\t文件\t{} 字节", metadata.len()))
            } else {
                (2, format!("{name}\t其他"))
            };
            entries.push(line);
        }
        entries.sort();
        let truncated = entries.len() > MAX_ENTRIES;
        let mut lines: Vec<String> = entries
            .into_iter()
            .take(MAX_ENTRIES)
            .map(|(_, line)| line)
            .collect();
        if truncated {
            lines.push(format!("[共 {total} 项，仅显示前 {MAX_ENTRIES} 项]"));
        }
        if lines.is_empty() {
            lines.push("[空目录]".into());
        }
        Ok(lines.join("\n"))
    })
    .await;
    match listed {
        Ok(Ok(body)) => ToolOutcome::ok(format!("目录 {display}：\n{body}")),
        Ok(Err(message)) => ToolOutcome::error(message),
        Err(_) => ToolOutcome::error("读取目录失败。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ai_assistant_tools_list_dir_reports_entries() {
        let root = std::env::temp_dir().join(format!("niuery-tool-list-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("a.txt"), b"12345").unwrap();
        let outcome = run(&json!({ "path": root.to_str().unwrap() })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("sub\t目录"));
        assert!(outcome.content.contains("a.txt\t文件\t5 字节"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_list_dir_rejects_files_and_bad_paths() {
        assert!(run(&json!({ "path": "relative" })).await.is_error);
        assert!(run(&json!({})).await.is_error);
        let root = std::env::temp_dir().join(format!("niuery-tool-list-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let outcome = run(&json!({ "path": file.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不是目录"));
        let empty = run(&json!({ "path": root.to_str().unwrap() })).await;
        assert!(!empty.is_error);
        std::fs::remove_dir_all(root).unwrap();
    }
}
