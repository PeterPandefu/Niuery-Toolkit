use super::super::{engine::transport::GuardedHttp, types::SearchService, validation};
use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "search_images";
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_IMAGES: u64 = 10;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "通过用户自行配置的搜索服务检索公开图片，返回图片直链列表（最多 10 条）。每次调用都需用户批准。返回的链接可作为后续 fetch_url 或下载保存的依据；不要凭空推测地址。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "图片检索关键词" },
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

pub struct ImagesOutcome {
    pub outcome: ToolOutcome,
    pub urls: Vec<String>,
}

fn fail(message: impl Into<String>) -> ImagesOutcome {
    ImagesOutcome {
        outcome: ToolOutcome::error(message),
        urls: Vec::new(),
    }
}

pub async fn run(
    arguments: &Value,
    config: &SearchService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ImagesOutcome {
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
        .clamp(1, MAX_IMAGES);
    let endpoint = match validation::endpoint(&config.base_url, "search") {
        Ok(value) => value,
        Err(message) => return fail(message),
    };
    let body = json!({
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
        "include_images": true
    });
    let response = match http
        .post_json_capped(endpoint.as_str(), &body, key, MAX_RESPONSE)
        .await
    {
        Ok(value) => value,
        Err(error) => return fail(error.message()),
    };
    if !(200..300).contains(&response.status) {
        return fail(format!(
            "搜索服务返回 HTTP {}，未获取结果。",
            response.status
        ));
    }
    let parsed: Value = match serde_json::from_slice(&response.body) {
        Ok(value) => value,
        Err(_) => return fail("搜索服务响应格式无效，请检查服务地址与协议。"),
    };
    let Some(images) = parsed.get("images").and_then(Value::as_array) else {
        return fail("搜索服务未返回图片列表；请确认该服务支持 include_images。");
    };
    let mut urls = Vec::new();
    for item in images.iter().take(max_results as usize) {
        let url = item
            .as_str()
            .or_else(|| item.get("url").and_then(Value::as_str))
            .filter(|value| !value.is_empty());
        if let Some(url) = url {
            urls.push(url.to_string());
        }
    }
    if urls.is_empty() {
        return ImagesOutcome {
            outcome: ToolOutcome::ok("未找到图片。"),
            urls,
        };
    }
    ImagesOutcome {
        outcome: ToolOutcome::ok(urls.join("\n")),
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
    async fn ai_assistant_tools_images_requests_include_images_and_collects_urls() {
        let body = br#"{"results":[],"images":["https://example.com/a.png",{"url":"https://example.com/b.jpg"}]}"#;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let mut raw = header.into_bytes();
        raw.extend_from_slice(body);
        let (base, server) = super::super::super::tests::mock_server(&raw, false).await;
        let http = GuardedHttp::for_tools().unwrap();
        let result = run(
            &json!({ "query": "cat", "max_results": 2 }),
            &config(&base),
            Some("k"),
            &http,
        )
        .await;
        assert!(!result.outcome.is_error, "{}", result.outcome.content);
        assert_eq!(
            result.urls,
            vec![
                "https://example.com/a.png".to_string(),
                "https://example.com/b.jpg".to_string()
            ]
        );
        let received = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(received.contains("\"include_images\":true"));
    }

    #[tokio::test]
    async fn ai_assistant_tools_images_reports_missing_image_list() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 14\r\nConnection: close\r\n\r\n{\"results\":[]}",
            false,
        )
        .await;
        let http = GuardedHttp::for_tools().unwrap();
        let result = run(&json!({ "query": "x" }), &config(&base), None, &http).await;
        assert!(result.outcome.is_error);
        assert!(result.outcome.content.contains("include_images"));
        server.await.unwrap();
    }
}
