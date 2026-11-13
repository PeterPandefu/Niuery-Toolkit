mod calculate;
mod file;
pub mod provenance;
mod search;
mod time;
mod web;

use super::{engine::transport::GuardedHttp, types::SearchService};
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
#[derive(Default)]
pub struct ToolEnv {
    pub search: Option<SearchService>,
    pub search_key: Option<String>,
}

impl ToolEnv {
    pub fn search_ready(&self) -> bool {
        self.search
            .as_ref()
            .is_some_and(|config| config.enabled && !config.base_url.trim().is_empty())
    }
}

pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
    pub approval: ApprovalLevel,
    pub annotations: ToolAnnotations,
}

impl ToolSpec {
    pub fn definition(&self) -> Option<ToolDefinition> {
        let name = ToolName::new(self.name).ok()?;
        Some(
            ToolDefinition::new(name, self.description, self.parameters.clone())
                .with_annotations(self.annotations.clone()),
        )
    }
}

/// The single authority on which tools exist. The frontend reads this through
/// `ai_list_tools` and never keeps its own copy of the definitions.
pub fn list(env: &ToolEnv) -> Vec<ToolSpec> {
    let mut specs = vec![time::spec(), calculate::spec(), file::spec(), web::spec()];
    if env.search_ready() {
        specs.push(search::spec());
    }
    specs
}

pub fn approval_of(name: &str) -> Option<ApprovalLevel> {
    list(&ToolEnv::default())
        .into_iter()
        .chain(std::iter::once(search::spec()))
        .find(|spec| spec.name == name)
        .map(|spec| spec.approval)
}

/// The approval dialog shows the resolved absolute path and real size, never
/// just the string the model wrote.
pub fn file_preview(arguments: &Value) -> Option<(String, u64)> {
    let path = arguments.get("path").and_then(Value::as_str)?;
    let (canonical, size) = file::resolve(path).ok()?;
    Some((canonical.display().to_string(), size))
}

pub fn info(env: &ToolEnv) -> Vec<super::types::ToolInfo> {
    list(env)
        .iter()
        .map(|spec| super::types::ToolInfo {
            name: spec.name.into(),
            description: spec.description.into(),
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
    match name {
        time::NAME => time::run(arguments),
        calculate::NAME => calculate::run(arguments),
        file::NAME => file::run(arguments).await,
        web::NAME => web::run(arguments, http).await,
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
        assert!(execute("no_such_tool", &json!({}), &http, &env).await.is_error);
        let huge = json!({ "expression": "1".repeat(MAX_ARGUMENTS_BYTES + 1) });
        let outcome = execute(calculate::NAME, &huge, &http, &env).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("参数过大"));
    }

    #[test]
    fn ai_assistant_tools_search_appears_only_when_configured() {
        let without = list(&ToolEnv::default());
        assert_eq!(without.len(), 4);
        assert!(!without.iter().any(|spec| spec.name == search::NAME));

        let env = ToolEnv {
            search: Some(SearchService {
                base_url: "https://example.com/v1".into(),
                has_api_key: true,
                enabled: true,
            }),
            search_key: Some("k".into()),
        };
        let with = list(&env);
        assert_eq!(with.len(), 5);
        assert!(with.iter().any(|spec| spec.name == search::NAME));

        let disabled = ToolEnv {
            search: Some(SearchService {
                base_url: "https://example.com/v1".into(),
                has_api_key: true,
                enabled: false,
            }),
            search_key: None,
        };
        assert!(!disabled.search_ready());
        assert_eq!(list(&disabled).len(), 4);
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
        assert_eq!(approval_of(file::NAME), Some(ApprovalLevel::Approve));
        assert_eq!(approval_of(web::NAME), Some(ApprovalLevel::Approve));
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
        };
        for spec in list(&env) {
            if spec.name == web::NAME || spec.name == search::NAME {
                assert!(spec.annotations.open_world());
                assert_eq!(spec.approval, ApprovalLevel::Approve);
            }
        }
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