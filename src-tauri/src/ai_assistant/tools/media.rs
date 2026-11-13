use super::super::{engine::transport::GuardedHttp, types::MediaService, validation};
use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::Path;

pub const IMAGE_NAME: &str = "generate_image";
pub const VIDEO_NAME: &str = "generate_video";
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES: usize = 100 * 1024 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;
const VIDEO_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);
const VIDEO_MAX_POLLS: usize = 60;

pub fn image_spec() -> ToolSpec {
    ToolSpec {
        name: IMAGE_NAME.into(),
        description: "调用用户自行配置的图像生成服务（OpenAI 兼容 /images/generations），按提示词生成一张图片并保存到本机指定路径。每次调用都需用户批准，批准前会展示保存路径。生成可能产生费用，提示词应忠实反映用户的要求。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "图像内容描述" },
                "path": { "type": "string", "description": "保存目标的绝对路径，扩展名须为 png/jpg/jpeg/webp，父目录必须已存在" },
                "size": { "type": "string", "description": "可选：尺寸，如 1024x1024、1536x1024、1024x1536，默认 1024x1024" }
            },
            "required": ["prompt", "path"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(true),
    }
}

pub fn video_spec() -> ToolSpec {
    ToolSpec {
        name: VIDEO_NAME.into(),
        description: "调用用户自行配置的视频生成服务（OpenAI 兼容 /videos：创建任务后轮询进度），按提示词生成一段视频并保存到本机指定路径。耗时可能达数分钟。每次调用都需用户批准，批准前会展示保存路径。生成可能产生费用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "视频内容描述，包含主体动作与镜头运动" },
                "path": { "type": "string", "description": "保存目标的绝对路径，扩展名须为 mp4/webm/mov，父目录必须已存在" }
            },
            "required": ["prompt", "path"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(false)
            .with_open_world(true),
    }
}

fn resolve_media_target(path: &str, extensions: &[&str]) -> Result<std::path::PathBuf, String> {
    let target = file::resolve_target(path)?;
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !extensions.contains(&extension.as_str()) {
        return Err(format!(
            "保存路径扩展名必须是 {} 之一。",
            extensions.join("/")
        ));
    }
    Ok(target)
}

fn save_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(target, bytes).map_err(|_| "写入文件失败，请检查权限或磁盘状态。".to_string())
}

pub async fn run_image(
    arguments: &Value,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ToolOutcome {
    let Some(prompt) = arguments.get("prompt").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 prompt 参数，或它不是字符串。");
    };
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    if prompt.trim().is_empty() {
        return ToolOutcome::error("提示词不能为空。");
    }
    let target = match resolve_media_target(path, &["png", "jpg", "jpeg", "webp"]) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let size = arguments
        .get("size")
        .and_then(Value::as_str)
        .unwrap_or("1024x1024");
    let endpoint = match validation::endpoint(&config.base_url, "images/generations") {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let mut body = json!({
        "prompt": prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json"
    });
    if let Some(model) = config
        .image_model
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        body["model"] = json!(model);
    }
    let response = match http
        .post_json_capped(endpoint.as_str(), &body, key, MAX_RESPONSE)
        .await
    {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!(
            "图像服务返回 HTTP {}，未生成图片。",
            response.status
        ));
    }
    let parsed: Value = match serde_json::from_slice(&response.body) {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("图像服务响应格式无效。"),
    };
    let Some(first) = parsed
        .get("data")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
    else {
        return ToolOutcome::error("图像服务未返回图片数据。");
    };
    let bytes = if let Some(encoded) = first.get("b64_json").and_then(Value::as_str) {
        use base64::Engine;
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(value) => value,
            Err(_) => return ToolOutcome::error("图像数据编码无效。"),
        }
    } else if let Some(url) = first.get("url").and_then(Value::as_str) {
        if let Err(message) = validation::validate_tool_url(url) {
            return ToolOutcome::error(message);
        }
        match http.get_capped(url, MAX_IMAGE_BYTES).await {
            Ok(value) if (200..300).contains(&value.status) => value.body,
            Ok(value) => {
                return ToolOutcome::error(format!("下载图片返回 HTTP {}。", value.status));
            }
            Err(error) => return ToolOutcome::error(error.message()),
        }
    } else {
        return ToolOutcome::error("图像服务未返回 b64_json 或 url。");
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return ToolOutcome::error("图片超过 20 MiB，已拒绝保存。");
    }
    match save_bytes(&target, &bytes) {
        Ok(()) => ToolOutcome::ok(format!(
            "已生成图像并保存到 {}（{} 字节）。",
            target.display(),
            bytes.len()
        )),
        Err(message) => ToolOutcome::error(message),
    }
}

pub async fn run_video(
    arguments: &Value,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ToolOutcome {
    let Some(prompt) = arguments.get("prompt").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 prompt 参数，或它不是字符串。");
    };
    let Some(path) = arguments.get("path").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 path 参数，或它不是字符串。");
    };
    if prompt.trim().is_empty() {
        return ToolOutcome::error("提示词不能为空。");
    }
    let target = match resolve_media_target(path, &["mp4", "webm", "mov"]) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let create_endpoint = match validation::endpoint(&config.base_url, "videos") {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let mut body = json!({ "prompt": prompt });
    if let Some(model) = config
        .video_model
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        body["model"] = json!(model);
    }
    let response = match http
        .post_json_capped(create_endpoint.as_str(), &body, key, MAX_RESPONSE)
        .await
    {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!(
            "视频服务返回 HTTP {}，未创建任务。",
            response.status
        ));
    }
    let parsed: Value = match serde_json::from_slice(&response.body) {
        Ok(value) => value,
        Err(_) => return ToolOutcome::error("视频服务响应格式无效。"),
    };
    let Some(id) = parsed
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return ToolOutcome::error("视频服务未返回任务 id。");
    };
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return ToolOutcome::error("视频任务 id 含非法字符，已拒绝轮询。");
    }
    let poll_endpoint = match validation::endpoint(&config.base_url, &format!("videos/{id}")) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    for _ in 0..VIDEO_MAX_POLLS {
        tokio::time::sleep(VIDEO_POLL_INTERVAL).await;
        let response = match http.get_capped(poll_endpoint.as_str(), MAX_RESPONSE).await {
            Ok(value) => value,
            Err(error) => return ToolOutcome::error(error.message()),
        };
        if !(200..300).contains(&response.status) {
            return ToolOutcome::error(format!("查询视频进度返回 HTTP {}。", response.status));
        }
        let parsed: Value = match serde_json::from_slice(&response.body) {
            Ok(value) => value,
            Err(_) => return ToolOutcome::error("视频进度响应格式无效。"),
        };
        let status = parsed.get("status").and_then(Value::as_str).unwrap_or("");
        match status {
            "completed" | "succeeded" | "success" => {
                let Some(url) = video_url(&parsed) else {
                    return ToolOutcome::error("视频已完成，但响应中没有下载地址。");
                };
                if let Err(message) = validation::validate_tool_url(&url) {
                    return ToolOutcome::error(message);
                }
                let download = match http.get_capped(&url, MAX_VIDEO_BYTES).await {
                    Ok(value) => value,
                    Err(error) => return ToolOutcome::error(error.message()),
                };
                if !(200..300).contains(&download.status) {
                    return ToolOutcome::error(format!("下载视频返回 HTTP {}。", download.status));
                }
                return match save_bytes(&target, &download.body) {
                    Ok(()) => ToolOutcome::ok(format!(
                        "已生成视频并保存到 {}（{} 字节）。",
                        target.display(),
                        download.body.len()
                    )),
                    Err(message) => ToolOutcome::error(message),
                };
            }
            "failed" | "error" | "cancelled" | "canceled" => {
                return ToolOutcome::error(format!("视频生成失败，服务状态：{status}。"));
            }
            _ => continue,
        }
    }
    ToolOutcome::error("视频生成超过 5 分钟仍未完成，已停止等待；可稍后用同一服务查询。")
}

fn video_url(parsed: &Value) -> Option<String> {
    for pointer in [
        "/video_url",
        "/url",
        "/output/url",
        "/output/video_url",
        "/result/url",
    ] {
        if let Some(url) = parsed
            .pointer(pointer)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            return Some(url.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base: &str) -> MediaService {
        MediaService {
            base_url: base.to_string(),
            has_api_key: true,
            enabled: true,
            image_model: None,
            video_model: None,
        }
    }

    fn temp_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-media-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_image_saves_b64_payload() {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.encode(b"fake-png-bytes");
        let body = format!("{{\"data\":[{{\"b64_json\":\"{png}\"}}]}}");
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let mut raw = header.into_bytes();
        raw.extend_from_slice(body.as_bytes());
        let (base, server) = super::super::super::tests::mock_server(&raw, false).await;
        let root = temp_root();
        let target = root.join("out.png");
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_image(
            &json!({ "prompt": "一只猫", "path": target.to_str().unwrap() }),
            &config(&base),
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read(&target).unwrap(), b"fake-png-bytes");
        let received = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(received.starts_with("POST /v1/images/generations "));
        assert!(received.contains("\"response_format\":\"b64_json\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_validates_arguments_before_request() {
        let http = GuardedHttp::for_tools().unwrap();
        let service = config("https://example.com/v1");
        assert!(run_image(&json!({}), &service, None, &http).await.is_error);
        assert!(
            run_image(
                &json!({ "prompt": " ", "path": "C:/x.png" }),
                &service,
                None,
                &http
            )
            .await
            .is_error
        );
        assert!(
            run_image(
                &json!({ "prompt": "x", "path": "relative.png" }),
                &service,
                None,
                &http
            )
            .await
            .is_error
        );
        assert!(
            run_image(
                &json!({ "prompt": "x", "path": "C:/x.gif" }),
                &service,
                None,
                &http
            )
            .await
            .is_error
        );
        assert!(
            run_video(
                &json!({ "prompt": "x", "path": "C:/x.png" }),
                &service,
                None,
                &http
            )
            .await
            .is_error
        );
    }

    #[test]
    fn ai_assistant_tools_media_video_url_reads_common_shapes() {
        assert_eq!(
            video_url(&json!({ "video_url": "https://a/v.mp4" })),
            Some("https://a/v.mp4".into())
        );
        assert_eq!(
            video_url(&json!({ "output": { "url": "https://b/v.mp4" } })),
            Some("https://b/v.mp4".into())
        );
        assert_eq!(video_url(&json!({})), None);
    }
}
