use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const NAME: &str = "glob_files";
const MAX_VISITED: usize = 20_000;
const MAX_MATCHES: usize = 200;
const MAX_DEPTH: usize = 24;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "在一个目录下按文件名模式查找文件，例如 src/**/*.ts 或 *.md。支持 *、?、** 通配符，返回相对路径列表（最多 200 条）。只读，不读取文件内容。每次调用都需用户批准，批准前会展示目标目录的绝对路径。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要搜索的目录的绝对路径" },
                "pattern": { "type": "string", "description": "glob 模式，相对于该目录，例如 **/*.rs" }
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
    let root = match file::resolve_dir(path) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let matcher = match globset::Glob::new(pattern) {
        Ok(glob) => glob.compile_matcher(),
        Err(_) => return ToolOutcome::error("glob 模式无效。"),
    };
    let visited_root = root.clone();
    let collected = tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();
        let mut visited = 0usize;
        let mut truncated = false;
        walk(
            &visited_root,
            &visited_root,
            0,
            &matcher,
            &mut matches,
            &mut visited,
            &mut truncated,
        );
        (matches, visited, truncated)
    })
    .await;
    let Ok((matches, visited, truncated)) = collected else {
        return ToolOutcome::error("搜索目录失败。");
    };
    if matches.is_empty() {
        return ToolOutcome::ok(format!("未找到匹配的文件（已遍历 {visited} 个条目）。"));
    }
    let mut text = matches.join("\n");
    if truncated {
        text.push_str(&format!(
            "\n[结果已截断：最多展示 {MAX_MATCHES} 条匹配，遍历上限 {MAX_VISITED} 个条目]"
        ));
    }
    ToolOutcome::ok(text)
}

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    matcher: &globset::GlobMatcher,
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
        // Link-free boundary: never descend through a symlink or reparse point.
        let Ok(metadata) = std::fs::symlink_metadata(&entry) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = match entry.strip_prefix(root) {
            Ok(value) => value.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if metadata.is_dir() {
            walk(
                root,
                &entry,
                depth + 1,
                matcher,
                matches,
                visited,
                truncated,
            );
        } else if matcher.is_match(&relative) {
            matches.push(relative);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree() -> PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-glob-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::write(root.join("src/a.ts"), "a").unwrap();
        std::fs::write(root.join("src/deep/b.ts"), "b").unwrap();
        std::fs::write(root.join("src/c.md"), "c").unwrap();
        std::fs::write(root.join("top.ts"), "t").unwrap();
        root
    }

    #[tokio::test]
    async fn ai_assistant_tools_glob_matches_recursive_patterns() {
        let root = temp_tree();
        let outcome =
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "src/**/*.ts" })).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("src/a.ts"));
        assert!(outcome.content.contains("src/deep/b.ts"));
        assert!(!outcome.content.contains("c.md"));
        assert!(!outcome.content.contains("top.ts"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_glob_reports_empty_and_rejects_bad_input() {
        let root = temp_tree();
        let outcome = run(&json!({ "path": root.to_str().unwrap(), "pattern": "*.zip" })).await;
        assert!(!outcome.is_error);
        assert!(outcome.content.contains("未找到"));
        assert!(
            run(&json!({ "path": "relative", "pattern": "*" }))
                .await
                .is_error
        );
        assert!(
            run(&json!({ "path": root.to_str().unwrap(), "pattern": "[" }))
                .await
                .is_error
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
