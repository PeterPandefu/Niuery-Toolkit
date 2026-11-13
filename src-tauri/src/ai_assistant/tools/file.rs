use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use crate::resources::install::reject_links;
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const NAME: &str = "read_local_file";
const MAX_BYTES: u64 = 1024 * 1024;
const LINK_REFUSED: &str = "路径包含符号链接或重解析点，已拒绝读取。";
const NOT_PLAIN_TEXT: &str = "文本附件最多 1 MiB，且必须是 UTF-8 纯文本";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "读取用户本机上的一个纯文本或代码文件。每次调用都需用户批准，批准前会展示完整绝对路径与文件大小。仅支持文本与常见代码文件，不支持 PDF、Word 等文档。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "文件的绝对路径，例如 C:/project/notes.md"
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

/// Resolves before approval so the dialog shows the real absolute path and size,
/// not whatever string the model wrote.
pub fn resolve(path: &str) -> Result<(PathBuf, u64), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空。".into());
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err("只接受绝对路径。".into());
    }
    reject_links(candidate).map_err(|_| LINK_REFUSED.to_string())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "文件不存在或无法访问。".to_string())?;
    reject_links(&canonical).map_err(|_| LINK_REFUSED.to_string())?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| "无法读取文件信息。".to_string())?;
    if !metadata.is_file() {
        return Err("目标不是普通文件。".into());
    }
    Ok((canonical, metadata.len()))
}

/// Resolves a write target that may not exist yet: the parent directory must
/// exist and be link-free; an existing target must be a regular file.
pub fn resolve_target(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空。".into());
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err("只接受绝对路径。".into());
    }
    reject_links(candidate).map_err(|_| LINK_REFUSED.to_string())?;
    let parent = candidate.parent().ok_or("路径缺少父目录。")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "父目录不存在或无法访问。".to_string())?;
    reject_links(&canonical_parent).map_err(|_| LINK_REFUSED.to_string())?;
    let name = candidate.file_name().ok_or("路径必须以文件名结尾。")?;
    let target = canonical_parent.join(name);
    if target.exists() {
        let metadata =
            std::fs::symlink_metadata(&target).map_err(|_| "无法读取文件信息。".to_string())?;
        if !metadata.is_file() {
            return Err("目标已存在且不是普通文件。".into());
        }
    }
    Ok(target)
}

pub fn resolve_dir(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空。".into());
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err("只接受绝对路径。".into());
    }
    reject_links(candidate).map_err(|_| LINK_REFUSED.to_string())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "目录不存在或无法访问。".to_string())?;
    reject_links(&canonical).map_err(|_| LINK_REFUSED.to_string())?;
    if !canonical.is_dir() {
        return Err("目标不是目录。".into());
    }
    Ok(canonical)
}

pub async fn run(arguments: &Value) -> ToolOutcome {
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    let (canonical, size) = match resolve(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let read = tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::Read;
        let file = std::fs::File::open(&canonical).map_err(|_| "无法打开文件。".to_string())?;
        let mut buffer = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut buffer)
            .map_err(|_| "读取文件失败。".to_string())?;
        if buffer.len() as u64 > MAX_BYTES {
            return Err(NOT_PLAIN_TEXT.into());
        }
        String::from_utf8(buffer).map_err(|_| NOT_PLAIN_TEXT.into())
    })
    .await;
    let data = match read {
        Ok(Ok(data)) => data,
        Ok(Err(message)) => return ToolOutcome::error(message),
        Err(_) => return ToolOutcome::error("读取文件失败。"),
    };
    match super::super::validation::validate_text_payload(&name, size, &data) {
        Ok(()) => ToolOutcome::ok(data),
        Err(message) => ToolOutcome::error(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-file-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[tokio::test]
    async fn ai_assistant_tools_file_reads_approved_plain_text() {
        let path = temp_file("notes.md", b"# hello\nworld");
        let outcome = run(&json!({ "path": path.to_str().unwrap() })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(outcome.content, "# hello\nworld");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_file_rejects_relative_missing_and_binary() {
        assert!(run(&json!({ "path": "relative/notes.md" })).await.is_error);
        assert!(run(&json!({ "path": "" })).await.is_error);
        assert!(run(&json!({})).await.is_error);
        let missing = std::env::temp_dir().join(format!("absent-{}.md", nanoid::nanoid!()));
        let outcome = run(&json!({ "path": missing.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不存在"));

        let binary = temp_file("image.png", &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        let outcome = run(&json!({ "path": binary.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        std::fs::remove_dir_all(binary.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_file_rejects_unsupported_extension_and_oversize() {
        let document = temp_file("report.pdf", b"plain bytes but wrong extension");
        let outcome = run(&json!({ "path": document.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不支持 PDF"));
        std::fs::remove_dir_all(document.parent().unwrap()).unwrap();

        let big = temp_file("big.txt", &vec![b'a'; (MAX_BYTES + 1) as usize]);
        let outcome = run(&json!({ "path": big.to_str().unwrap() })).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("1 MiB"));
        std::fs::remove_dir_all(big.parent().unwrap()).unwrap();
    }

    #[test]
    fn ai_assistant_tools_file_resolve_reports_absolute_path_and_size() {
        let path = temp_file("sized.txt", b"12345");
        let (canonical, size) = resolve(path.to_str().unwrap()).unwrap();
        assert!(canonical.is_absolute());
        assert_eq!(size, 5);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
