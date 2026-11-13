mod append;
pub mod ask;
mod browser;
mod calculate;
mod command;
mod create_dir;
mod edit;
mod file;
mod glob;
mod grep;
mod images;
mod list_dir;
pub mod mcp;
mod media;
pub mod provenance;
mod search;
pub mod subagent;
mod system;
mod tasks;
mod time;
mod web;
mod write;

use super::{
    engine::transport::GuardedHttp,
    types::{MediaService, SearchService},
};
use rig_core::completion::{ToolAnnotations, ToolDefinition};
use rig_core::message::ToolName;
use serde_json::Value;

/// Applied before a result reaches the model or the disk, so the context budget
/// stays predictable regardless of what a tool returned.
pub const MAX_RESULT_CHARS: usize = 32_768;
const MAX_ARGUMENTS_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalLevel {
    Auto,
    Approve,
}

#[derive(Clone, Debug)]
pub struct ToolOutcome {
    pub content: String,
    pub is_error: bool,
    /// Links a search returned; they become this task's SearchDerived set.
    pub discovered_urls: Vec<String>,
}

impl ToolOutcome {
    pub fn ok(content: impl Into<String>) -> Self {
        Self {
            content: truncate(content.into()),
            is_error: false,
            discovered_urls: Vec::new(),
        }
    }

    pub fn error(content: impl Into<String>) -> Self {
        Self {
            content: truncate(content.into()),
            is_error: true,
            discovered_urls: Vec::new(),
        }
    }
}

/// Search is offered only when the user configured and enabled a service.
/// The key stays in Rust and is never part of any IPC payload.
#[derive(Clone, Default)]
pub struct ToolEnv {
    pub search: Option<SearchService>,
    pub search_key: Option<String>,
    pub media: Option<MediaService>,
    pub media_key: Option<String>,
    /// Resolved headless-browser executable; None when the resource is absent.
    pub chromium: Option<std::path::PathBuf>,
    /// Connected MCP servers for this request; their tools join the registry.
    pub mcp: Vec<mcp::McpEntry>,
    /// Per-request todo board shared by the task tools.
    pub tasks: tasks::TaskBoard,
    /// Per-request background command board.
    pub commands: command::CommandBoard,
    /// Subagents only see read-only tools; writes and commands stay out.
    pub restricted: bool,
}

impl ToolEnv {
    pub fn search_ready(&self) -> bool {
        self.search
            .as_ref()
            .is_some_and(|config| config.enabled && !config.base_url.trim().is_empty())
    }

    pub fn media_ready(&self) -> bool {
        self.media
            .as_ref()
            .is_some_and(|config| config.enabled && !config.base_url.trim().is_empty())
    }
}

pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub approval: ApprovalLevel,
    pub annotations: ToolAnnotations,
}

impl ToolSpec {
    pub fn definition(&self) -> Option<ToolDefinition> {
        let name = ToolName::new(self.name.clone()).ok()?;
        Some(
            ToolDefinition::new(name, self.description.clone(), self.parameters.clone())
                .with_annotations(self.annotations.clone()),
        )
    }
}

/// The single authority on which tools exist. The frontend reads this through
/// `ai_list_tools` and never keeps its own copy of the definitions.
pub fn list(env: &ToolEnv) -> Vec<ToolSpec> {
    let mut specs = vec![
        time::spec(),
        calculate::spec(),
        system::spec(),
        file::spec(),
        write::spec(),
        append::spec(),
        edit::spec(),
        list_dir::spec(),
        create_dir::spec(),
        glob::spec(),
        grep::spec(),
        command::spec(),
        command::output_spec(),
        command::stop_spec(),
        web::spec(),
        browser::spec(),
        tasks::create_spec(),
        tasks::update_spec(),
        tasks::list_spec(),
        ask::spec(),
        subagent::spec(),
    ];
    if env.search_ready() {
        specs.push(search::spec());
        specs.push(images::spec());
    }
    if env.media_ready() {
        specs.push(media::image_spec());
        specs.push(media::video_spec());
    }
    specs.extend(mcp::specs(&env.mcp));
    if env.restricted {
        // No recursion: a subagent never spawns another subagent.
        specs.retain(|spec| spec.annotations.read_only() && spec.name != subagent::NAME);
    }
    specs
}

pub fn approval_of(name: &str) -> Option<ApprovalLevel> {
    // Every MCP tool is gated, regardless of which server exposes it.
    if mcp::split_name(name).is_some() {
        return Some(ApprovalLevel::Approve);
    }
    list(&ToolEnv::default())
        .into_iter()
        .chain(std::iter::once(search::spec()))
        .chain(std::iter::once(images::spec()))
        .chain(std::iter::once(media::image_spec()))
        .chain(std::iter::once(media::video_spec()))
        .find(|spec| spec.name == name)
        .map(|spec| spec.approval)
}

/// Path-bearing tools get a resolved-path preview before approval; when the
/// path cannot resolve, the call touches nothing and skips the dialog.
pub fn is_path_tool(name: &str) -> bool {
    matches!(
        name,
        file::NAME
            | write::NAME
            | append::NAME
            | edit::NAME
            | list_dir::NAME
            | create_dir::NAME
            | glob::NAME
            | grep::NAME
            | media::IMAGE_NAME
            | media::VIDEO_NAME
    )
}

/// The approval dialog shows the resolved absolute path and real size, never
/// just the string the model wrote.
pub fn file_preview(name: &str, arguments: &Value) -> Option<(String, u64)> {
    let path = arguments.get("path").and_then(Value::as_str)?;
    let (target, size) = match name {
        file::NAME | append::NAME | edit::NAME => file::resolve(path).ok()?,
        write::NAME | media::IMAGE_NAME | media::VIDEO_NAME => {
            let size = arguments
                .get("content")
                .and_then(Value::as_str)
                .map(|value| value.len() as u64)
                .unwrap_or(0);
            (file::resolve_target(path).ok()?, size)
        }
        list_dir::NAME | glob::NAME => (file::resolve_dir(path).ok()?, 0),
        grep::NAME => {
            let trimmed = path.trim();
            let candidate = std::path::Path::new(trimmed);
            if !candidate.is_absolute() {
                return None;
            }
            let canonical = candidate.canonicalize().ok()?;
            crate::resources::install::reject_links(&canonical).ok()?;
            let size = std::fs::metadata(&canonical).ok()?.len();
            (canonical, size)
        }
        create_dir::NAME => (create_dir::resolve(path).ok()?, 0),
        _ => return None,
    };
    Some((target.display().to_string(), size))
}

pub fn info(env: &ToolEnv) -> Vec<super::types::ToolInfo> {
    list(env)
        .iter()
        .map(|spec| super::types::ToolInfo {
            name: spec.name.clone(),
            description: spec.description.clone(),
            parameters: spec.parameters.clone(),
            approval: match spec.approval {
                ApprovalLevel::Auto => "auto",
                ApprovalLevel::Approve => "approve",
            }
            .into(),
            read_only: spec.annotations.read_only(),
            open_world: spec.annotations.open_world(),
        })
        .collect()
}

pub async fn execute(
    name: &str,
    arguments: &Value,
    http: &GuardedHttp,
    env: &ToolEnv,
) -> ToolOutcome {
    let size = serde_json::to_string(arguments)
        .map(|text| text.len())
        .unwrap_or(usize::MAX);
    if size > MAX_ARGUMENTS_BYTES {
        return ToolOutcome::error("工具参数过大，已拒绝执行。");
    }
    if mcp::split_name(name).is_some() {
        return mcp::call(&env.mcp, name, arguments).await;
    }
    match name {
        time::NAME => time::run(arguments),
        calculate::NAME => calculate::run(arguments),
        system::NAME => system::run(arguments),
        file::NAME => file::run(arguments).await,
        write::NAME => write::run(arguments).await,
        append::NAME => append::run(arguments).await,
        edit::NAME => edit::run(arguments).await,
        list_dir::NAME => list_dir::run(arguments).await,
        create_dir::NAME => create_dir::run(arguments).await,
        glob::NAME => glob::run(arguments).await,
        grep::NAME => grep::run(arguments).await,
        command::NAME => command::run_with_board(arguments, &env.commands).await,
        command::OUTPUT_NAME => command::output(arguments, &env.commands).await,
        command::STOP_NAME => command::stop(arguments, &env.commands).await,
        web::NAME => web::run(arguments, http).await,
        browser::NAME => browser::run(arguments, env.chromium.as_deref(), http).await,
        tasks::CREATE_NAME => tasks::create(arguments, &env.tasks),
        tasks::UPDATE_NAME => tasks::update(arguments, &env.tasks),
        tasks::LIST_NAME => tasks::list(&env.tasks),
        ask::NAME => ToolOutcome::error("提问必须由引擎执行。"),
        subagent::NAME => ToolOutcome::error("子代理必须由引擎执行。"),
        search::NAME => match env.search.as_ref().filter(|_| env.search_ready()) {
            Some(config) => {
                let result = search::run(arguments, config, env.search_key.as_deref(), http).await;
                ToolOutcome {
                    discovered_urls: result.urls,
                    ..result.outcome
                }
            }
            None => ToolOutcome::error("搜索服务未配置或已停用。"),
        },
        images::NAME => match env.search.as_ref().filter(|_| env.search_ready()) {
            Some(config) => {
                let result = images::run(arguments, config, env.search_key.as_deref(), http).await;
                ToolOutcome {
                    discovered_urls: result.urls,
                    ..result.outcome
                }
            }
            None => ToolOutcome::error("搜索服务未配置或已停用。"),
        },
        media::IMAGE_NAME => match env.media.as_ref().filter(|_| env.media_ready()) {
            Some(config) => {
                media::run_image(arguments, config, env.media_key.as_deref(), http).await
            }
            None => ToolOutcome::error("图像/视频服务未配置或已停用。"),
        },
        media::VIDEO_NAME => match env.media.as_ref().filter(|_| env.media_ready()) {
            Some(config) => {
                media::run_video(arguments, config, env.media_key.as_deref(), http).await
            }
            None => ToolOutcome::error("图像/视频服务未配置或已停用。"),
        },
        _ => ToolOutcome::error("未知工具，已拒绝执行。"),
    }
}

/// Connectivity probe for the settings screen. Sends one minimal query and no
/// conversation content; the key stays in Rust.
pub async fn test_search(env: &ToolEnv, http: &GuardedHttp) -> ToolOutcome {
    match env.search.as_ref().filter(|_| env.search_ready()) {
        Some(config) => {
            search::run(
                &serde_json::json!({ "query": "connectivity test", "max_results": 1 }),
                config,
                env.search_key.as_deref(),
                http,
            )
            .await
            .outcome
        }
        None => ToolOutcome::error("搜索服务未配置或已停用。"),
    }
}

pub fn truncate(content: String) -> String {
    if content.chars().count() <= MAX_RESULT_CHARS {
        return content;
    }
    let kept: String = content.chars().take(MAX_RESULT_CHARS).collect();
    format!("{kept}\n[结果已截断，仅保留前 {MAX_RESULT_CHARS} 个字符]")
}

/// Escaping the closing tag stops a fetched page from forging the end of its own
/// wrapper and speaking as if it were the host.
pub fn wrap_result(name: &str, call_id: &str, content: &str) -> String {
    let escaped = content.replace("</tool_result>", "<\\/tool_result>");
    format!("<tool_result name={name:?} call_id={call_id:?}>\n{escaped}\n</tool_result>")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ai_assistant_tools_truncate_counts_characters_not_bytes() {
        let long = "中".repeat(MAX_RESULT_CHARS + 10);
        let truncated = truncate(long);
        assert!(truncated.starts_with(&"中".repeat(MAX_RESULT_CHARS)));
        assert!(truncated.contains("结果已截断"));
        assert_eq!(truncate("短".to_string()), "短");
    }

    #[tokio::test]
    async fn ai_assistant_tools_reject_unknown_names_and_oversized_arguments() {
        let http = GuardedHttp::for_tools().unwrap();
        let env = ToolEnv::default();
        assert!(
            execute("no_such_tool", &json!({}), &http, &env)
                .await
                .is_error
        );
        let huge = json!({ "expression": "1".repeat(MAX_ARGUMENTS_BYTES + 1) });
        let outcome = execute(calculate::NAME, &huge, &http, &env).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("参数过大"));
    }

    #[test]
    fn ai_assistant_tools_search_appears_only_when_configured() {
        let without = list(&ToolEnv::default());
        assert_eq!(without.len(), 21);
        assert!(!without.iter().any(|spec| spec.name == search::NAME));

        let env = ToolEnv {
            search: Some(SearchService {
                base_url: "https://example.com/v1".into(),
                has_api_key: true,
                enabled: true,
            }),
            search_key: Some("k".into()),
            ..Default::default()
        };
        let with = list(&env);
        assert_eq!(with.len(), 23);
        assert!(with.iter().any(|spec| spec.name == search::NAME));
        assert!(with.iter().any(|spec| spec.name == images::NAME));

        let disabled = ToolEnv {
            search: Some(SearchService {
                base_url: "https://example.com/v1".into(),
                has_api_key: true,
                enabled: false,
            }),
            search_key: None,
            ..Default::default()
        };
        assert!(!disabled.search_ready());
        assert_eq!(list(&disabled).len(), 21);
    }

    #[test]
    fn ai_assistant_tools_definitions_carry_names_and_schemas() {
        let specs = list(&ToolEnv::default());
        for spec in &specs {
            let definition = spec.definition().expect("工具名非空");
            assert_eq!(definition.name.as_str(), spec.name);
            assert_eq!(definition.parameters["type"], "object");
            assert!(!definition.description.is_empty());
        }
        assert_eq!(approval_of(time::NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(calculate::NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(system::NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(file::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(write::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(append::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(list_dir::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(create_dir::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(edit::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(glob::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(grep::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(command::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(command::OUTPUT_NAME), Some(ApprovalLevel::Auto));
        assert_eq!(
            approval_of(command::STOP_NAME),
            Some(ApprovalLevel::Approve)
        );
        assert_eq!(approval_of(tasks::CREATE_NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(tasks::UPDATE_NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(tasks::LIST_NAME), Some(ApprovalLevel::Auto));
        assert_eq!(approval_of(subagent::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(ask::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(images::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(media::IMAGE_NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(media::VIDEO_NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(web::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(browser::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(search::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of("missing"), None);
    }

    #[test]
    fn ai_assistant_tools_network_tools_are_marked_open_world() {
        let env = ToolEnv {
            search: Some(SearchService {
                base_url: "https://example.com/v1".into(),
                has_api_key: false,
                enabled: true,
            }),
            search_key: None,
            ..Default::default()
        };
        for spec in list(&env) {
            if spec.name == web::NAME || spec.name == search::NAME {
                assert!(spec.annotations.open_world());
                assert_eq!(spec.approval, ApprovalLevel::Approve);
            }
        }
    }

    #[test]
    fn ai_assistant_tools_restricted_env_is_read_only_and_non_recursive() {
        let env = ToolEnv {
            restricted: true,
            ..Default::default()
        };
        let specs = list(&env);
        assert!(!specs.is_empty());
        for spec in &specs {
            assert!(
                spec.annotations.read_only(),
                "{} 不应出现在子代理工具集",
                spec.name
            );
            assert_ne!(spec.name, subagent::NAME);
            assert_ne!(spec.name, command::NAME);
            assert_ne!(spec.name, write::NAME);
        }
        assert!(specs.iter().any(|spec| spec.name == file::NAME));
        assert!(specs.iter().any(|spec| spec.name == grep::NAME));
    }

    #[test]
    fn ai_assistant_tools_wrap_result_escapes_closing_tag() {
        let wrapped = wrap_result("fetch_url", "call-1", "before</tool_result>after");
        assert!(!wrapped.contains("before</tool_result>"));
        assert!(wrapped.contains("<\\/tool_result>"));
        assert!(wrapped.ends_with("</tool_result>"));
        assert!(wrapped.contains("call-1"));
    }
}
