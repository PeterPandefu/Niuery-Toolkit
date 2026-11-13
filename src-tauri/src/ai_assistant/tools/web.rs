use super::super::{engine::transport::GuardedHttp, validation};
use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "fetch_url";
const MAX_BYTES: usize = 2 * 1024 * 1024;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME,
        description: "抓取一个 HTTP/HTTPS 网页并返回其纯文本。每次调用都需用户批准，批准前会展示原样 URL 与来源。只应抓取与当前任务直接相关、且来自用户消息或本次搜索结果的地址；不要抓取模型凭空推测的地址，也不要使用任何代理或镜像地址。",
        parameters: json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "完整的 HTTP/HTTPS 地址，可含查询参数，不得含用户名或密码"
                }
            },
            "required": ["url"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(true),
    }
}

pub async fn run(arguments: &Value, http: &GuardedHttp) -> ToolOutcome {
    let Some(url) = arguments.get("url").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 url 参数，或它不是字符串。");
    };
    if let Err(message) = validation::validate_tool_url(url) {
        return ToolOutcome::error(message);
    }
    // Verbatim: no prefixing, no mirror fallback, no alternate-host retry.
    let response = match http.get_capped(url, MAX_BYTES).await {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    if (300..400).contains(&response.status) {
        let location = response
            .location
            .unwrap_or_else(|| "（未提供）".to_string());
        return ToolOutcome::error(format!(
            "目标返回重定向（HTTP {}），已按策略拒绝跟随。Location：{location}\n若认可该新地址，请作为一次全新调用重新提出，需重新批准。",
            response.status
        ));
    }
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!("目标返回 HTTP {}，未获取内容。", response.status));
    }
    let text = String::from_utf8_lossy(&response.body).into_owned();
    let kind = response.content_type.unwrap_or_default().to_lowercase();
    let extracted = if kind.contains("text/html") || kind.contains("application/xhtml") {
        html_to_text(&text)
    } else if kind.is_empty()
        || kind.starts_with("text/")
        || kind.contains("json")
        || kind.contains("xml")
    {
        text
    } else {
        return ToolOutcome::error("目标不是文本内容，已拒绝读取。");
    };
    ToolOutcome::ok(extracted)
}

fn html_to_text(html: &str) -> String {
    let document = dom_query::Document::from(html);
    document
        .select("script,style,noscript,template,svg,iframe")
        .remove();
    let body = document.select("body").text();
    let raw = if body.trim().is_empty() {
        document.select("html").text()
    } else {
        body
    };
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_assistant_tools_web_extracts_text_and_drops_scripts() {
        let html = "<html><head><style>b{color:red}</style></head><body><script>evil()</script><h1>Title</h1><p>Hello   world</p></body></html>";
        let text = html_to_text(html);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
        assert!(!text.contains("evil"));
        assert!(!text.contains("color:red"));
    }

    #[test]
    fn ai_assistant_tools_web_url_rules_allow_query_but_refuse_credentials() {
        assert!(validation::validate_tool_url("https://example.com/a?x=1#frag").is_ok());
        assert!(validation::validate_tool_url("http://127.0.0.1:8080/page").is_ok());
        assert!(validation::validate_tool_url("https://user:pass@example.com/").is_err());
        assert!(validation::validate_tool_url("file:///etc/passwd").is_err());
        assert!(validation::validate_tool_url("javascript:alert(1)").is_err());
        assert!(validation::validate_tool_url("not a url").is_err());
    }

    #[tokio::test]
    async fn ai_assistant_tools_web_sends_the_url_verbatim() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
            false,
        )
        .await;
        let target = format!("{base}/exact/path?keep=1");
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run(&json!({ "url": target }), &http).await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(outcome.content, "hello");
        let received = String::from_utf8(server.await.unwrap()).unwrap();
        let request_line = received.lines().next().unwrap_or("");
        assert_eq!(request_line, "GET /v1/exact/path?keep=1 HTTP/1.1");
    }

    #[tokio::test]
    async fn ai_assistant_tools_web_never_follows_a_redirect() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            false,
        )
        .await;
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run(&json!({ "url": format!("{base}/page") }), &http).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("拒绝跟随"));
        assert!(outcome.content.contains("http://127.0.0.1:1/steal"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_web_refuses_non_text_and_reports_http_errors() {
        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\nConnection: close\r\n\r\nab",
            false,
        )
        .await;
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run(&json!({ "url": format!("{base}/bin") }), &http).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("不是文本"));
        server.await.unwrap();

        let (base, server) = super::super::super::tests::mock_server(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            false,
        )
        .await;
        let outcome = run(&json!({ "url": format!("{base}/missing") }), &http).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("404"));
        server.await.unwrap();
    }
}