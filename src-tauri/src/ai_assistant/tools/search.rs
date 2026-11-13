use super::super::{engine::transport::GuardedHttp, types::SearchService, validation};
use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "web_search";
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_RESULTS: u64 = 10;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME,
        description: "通过用户自行配置的搜索服务检索公开网页，返回标题、链接与摘要。每次调用都需用户批准。返回的链接可作为后续 fetch_url 的依据；不要凭空推测地址，也不要使用任何代理或镜像地址。",
        parameters: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "检索关键词" },
                "max_results": { "type": "integer", "minimum": 1, "maximum": 10, "description": "返回条数，默认 5" }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(true),
    }
}

pub struct SearchOutcome {
    pub outcome: ToolOutcome,
    /// Result links become this task's SearchDerived provenance set.
    pub urls: Vec<String>,
}

fn fail(message: impl Into<String>) -> SearchOutcome {
    SearchOutcome {
        outcome: ToolOutcome::error(message),
        urls: Vec::new(),
    }
}

pub async fn run(
    arguments: &Value,
    config: &SearchService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> SearchOutcome {
    let Some(query) = arguments.get("query").and_then(Value::as_str) else {
        return fail("缺少 query 参数，或它不是字符串。");
    };
    if query.trim().is_empty() {
        return fail("查询内容不能为空。");
    }
    let max_results = arguments
        .get("max_results")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(1, MAX_RESULTS);
    // The only URL construction in the tool layer: user config plus a fixed suffix.
    let endpoint = match validation::endpoint(&config.base_url, "search") {
        Ok(value) => value,
        Err(message) => return fail(message),
    };
    let body = json!({ "query": query, "max_results": max_results, "search_depth": "basic" });
    let response = match http
        .post_json_capped(endpoint.as_str(), &body, key, MAX_RESPONSE)
        .await
    {
        Ok(value) => value,
        Err(error) => return fail(error.message()),
    };
    if !(200..300).contains(&response.status) {
        return fail(format!("搜索服务返回 HTTP {}，未获取结果。", response.status));
    }
    let parsed: Value = match serde_json::from_slice(&response.body) {
        Ok(value) => value,
        Err(_) => return fail("搜索服务响应格式无效，请检查服务地址与协议。"),
    };
    let Some(results) = parsed.get("results").and_then(Value::as_array) else {
        return fail("搜索服务未返回结果列表，请检查服务地址与协议。");
    };
    let mut urls = Vec::new();
    let mut lines = Vec::new();
    for item in results.iter().take(max_results as usize) {
        let Some(url) = item.get("url").and_then(Value::as_str).filter(|v| !v.is_empty()) else {
            continue;
        };
        let title = item.get("title").and_then(Value::as_str).unwrap_or("");
        let snippet = item.get("content").and_then(Value::as_str).unwrap_or("");
        urls.push(url.to_string());
        lines.push(format!("- {title}\n  {url}\n  {snippet}"));
    }
    if lines.is_empty() {
        return SearchOutcome {
            outcome: ToolOutcome::ok("未找到结果。"),
            urls,
        };
    }
    SearchOutcome {
        outcome: ToolOutcome::ok(lines.join("\n")),
        urls,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base: &str) -> SearchService {
        SearchService {
            base_url: base.to_string(),
            has_api_key: true,
            enabled: true,
        }
    }

    #[tokio::test]
    async fn ai_assistant_tools_search_posts_to_configured_endpoint_and_collects_urls() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 108\r\nConnection: close\r\n\r\n{\"results\":[{\"title\":\"T\",\"url\":\"https://example.com/found\",\"content\":\"snippet\"}]}",
            false,
        )
        .await;
        let http = GuardedHttp::for_tools().unwrap();
        let result = run(
            &json!({ "query": "rust", "max_results": 3 }),
            &config(&base),
            Some("search-key"),
            &http,
        )
        .await;
        assert!(!result.outcome.is_error, "{}", result.outcome.content);
        assert_eq!(result.urls, vec!["https://example.com/found".to_string()]);
        let received = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(received.starts_with("POST /v1/search "));
        assert!(received.to_lowercase().contains("authorization: bearer search-key"));
        assert!(received.contains("\"max_results\":3"));
    }

    #[tokio::test]
    async fn ai_assistant_tools_search_reports_bad_shapes_without_leaking_the_key() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
            false,
        )
        .await;
        let http = GuardedHttp::for_tools().unwrap();
        let result = run(&json!({ "query": "x" }), &config(&base), Some("secret-key"), &http).await;
        assert!(result.outcome.is_error);
        assert!(!result.outcome.content.contains("secret-key"));
        assert!(result.urls.is_empty());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_search_validates_arguments_before_any_request() {
        let http = GuardedHttp::for_tools().unwrap();
        let service = config("https://example.com/v1");
        assert!(run(&json!({}), &service, None, &http).await.outcome.is_error);
        assert!(run(&json!({ "query": "  " }), &service, None, &http)
            .await
            .outcome
            .is_error);
        assert!(run(&json!({ "query": "x" }), &config("not a url"), None, &http)
            .await
            .outcome
            .is_error);
    }
}