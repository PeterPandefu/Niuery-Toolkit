use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const NAME: &str = "grep_content";
const MAX_VISITED: usize = 20_000;
const MAX_MATCHES: usize = 100;
const MAX_DEPTH: usize = 24;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_LINE_CHARS: usize = 400;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "在一个目录或单个文件中按正则表达式搜索文本内容，返回 文件路径:行号:匹配行（最多 100 条）。跳过二进制文件与符号链接。只读。每次调用都需用户批准，批准前会展示目标绝对路径。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "目录或文件的绝对路径" },
                "pattern": { "type": "string", "description": "Rust 正则表达式，例如 fn\\s+main" },
                "file_glob": { "type": "string", "description": "可选：只搜索匹配该 glob 的文件名，例如 *.rs" },
                "ignore_case": { "type": "boolean", "description": "可选：忽略大小写，默认 false" }
            },
            "required": ["path", "pattern"],
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
    let Some(pattern) = arguments.get("pattern").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 pattern 参数，或它不是字符串。");
    };
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return ToolOutcome::error("路径不能为空。");
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return ToolOutcome::error("只接受绝对路径。");
    }
    let target = match candidate.canonicalize() {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("路径不存在或无法访问。"),
    };
    if crate::resources::install::reject_links(&target).is_err() {
        return ToolOutcome::error("路径包含符号链接或重解析点，已拒绝搜索。");
    }
    let regex = match regex::RegexBuilder::new(pattern)
        .case_insensitive(
            arguments
                .get("ignore_case")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .size_limit(1024 * 1024)
        .build()
    {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("正则表达式无效或过于复杂。"),
    };
    let file_filter = match arguments.get("file_glob").and_then(Value::as_str) {
        Some(glob) => match globset::Glob::new(glob) {
            Ok(value) => Some(value.compile_matcher()),
            Err(_) => return ToolOutcome::error("file_glob 模式无效。"),
        },
        None => None,
    };
    let collected = tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();
        let mut visited = 0usize;
        let mut truncated = false;
        if target.is_file() {
            search_file(&target, &target, &regex, file_filter.as_ref(), &mut matches);
        } else {
            walk(
                &target,
                &target,
                0,
                &regex,
                file_filter.as_ref(),
                &mut matches,
                &mut visited,
                &mut truncated,
            );
        }
        (matches, truncated)
    })
    .await;
    let Ok((matches, truncated)) = collected else {
        return ToolOutcome::error("搜索失败。");
    };
    if matches.is_empty() {
        return ToolOutcome::ok("未找到匹配内容。");
    }
    let mut text = matches.join("\n");
    if truncated {
        text.push_str(&format!("\n[结果已截断：最多展示 {MAX_MATCHES} 条匹配]"));
    }
    ToolOutcome::ok(text)
}

#[allow(clippy::too_many_arguments)]
fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    regex: &regex::Regex,
    filter: Option<&globset::GlobMatcher>,
    matches: &mut Vec<String>,
    visited: &mut usize,
    truncated: &mut bool,
) {
    if depth > MAX_DEPTH || *visited >= MAX_VISITED || matches.len() >= MAX_MATCHES {
        *truncated = true;
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .collect();
    entries.sort();
    for entry in entries {
        if *visited >= MAX_VISITED || matches.len() >= MAX_MATCHES {
            *truncated = true;
            return;
        }
        *visited += 1;
        let Ok(metadata) = std::fs::symlink_metadata(&entry) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            walk(
                root,
                &entry,
                depth + 1,
                regex,
                filter,
                matches,
                visited,
                truncated,
            );
        } else {
            search_file(root, &entry, regex, filter, matches);
        }
    }
}

fn search_file(
    root: &Path,
    path: &Path,
    regex: &regex::Regex,
    filter: Option<&globset::GlobMatcher>,
    matches: &mut Vec<String>,
) {
    if matches.len() >= MAX_MATCHES {
        return;
    }
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    if let Some(filter) = filter {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !filter.is_match(name) && !filter.is_match(&relative) {
            return;
        }
    }
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(data) = std::fs::read(path) else {
        return;
    };
    let Ok(text) = String::from_utf8(data) else {
        return;
    };
    for (index, line) in text.lines().enumerate() {
        if matches.len() >= MAX_MATCHES {
            return;
        }
        if regex.is_match(line) {
            let shown: String = line.chars().take(MAX_LINE_CHARS).collect();
            matches.push(format!("{relative}:{}:{shown}", index + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree() -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-grep-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "fn main() {}\nlet x = 1;\n").unwrap();
        std::fs::write(root.join("src/b.txt"), "nothing here\n").unwrap();
        std::fs::write(root.join("src/bin.dat"), [0u8, 159, 146, 150]).unwrap();
        root
    }

    #[tokio::test]
    async fn ai_assistant_tools_grep_finds_lines_with_numbers() {
        let root = temp_tree();
        let outcome =
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "fn\\s+main" })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("src/a.rs:1:fn main() {}"));
        assert!(!outcome.content.contains("b.txt"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_grep_supports_filter_case_and_single_file() {
        let root = temp_tree();
        let outcome = run(&json!({
            "path": root.to_str().unwrap(), "pattern": "FN", "ignore_case": true, "file_glob": "*.rs"
        }))
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("a.rs:1"));
        let single =
            run(&json!({ "path": root.join("src/a.rs").to_str().unwrap(), "pattern": "let x" }))
                .await;
        assert!(!single.is_error);
        assert!(single.content.contains(":2:let x = 1;"));
        let empty =
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "zzz-not-there" })).await;
        assert!(empty.content.contains("未找到"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_grep_rejects_bad_regex_and_paths() {
        let root = temp_tree();
        assert!(
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "(" }))
                .await
                .is_error
        );
        assert!(
            run(&json!({ "path": "relative", "pattern": "x" }))
                .await
                .is_error
        );
        assert!(
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "x", "file_glob": "[" }))
                .await
                .is_error
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
