use super::super::{
    engine::transport::GuardedHttp,
    types::{MediaProtocol, MediaService},
    validation,
};
use super::{file, ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::path::Path;

pub const IMAGE_NAME: &str = "generate_image";
pub const VIDEO_NAME: &str = "generate_video";
pub const IMAGE_VIDEO_NAME: &str = "generate_video_from_image";
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES: usize = 100 * 1024 * 1024;
const MAX_INPUT_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;
const VIDEO_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);
const VIDEO_MAX_POLLS: usize = 60;
const DASHSCOPE_MAX_POLLS: usize = 120;
const DEFAULT_IMAGE_MODEL: &str = "qwen-image-3.0";
const DEFAULT_VIDEO_MODEL: &str = "wan2.6-t2v";
const DEFAULT_IMAGE_VIDEO_MODEL: &str = "wan2.6-i2v-flash";

pub fn image_spec() -> ToolSpec {
    ToolSpec {
        name: IMAGE_NAME.into(),
        description: "调用用户自行配置的图像生成服务，按提示词生成一张图片并保存到本机指定路径。支持 OpenAI 兼容 /images/generations 与千问平台（DashScope 协议，qwen-image 系列）。调用前按会话权限模式审批（默认每次询问），批准前会展示保存路径。生成可能产生费用，提示词应忠实反映用户的要求。".into(),
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
        description: "调用用户自行配置的视频生成服务，按提示词生成一段视频并保存到本机指定路径。支持 OpenAI 兼容 /videos 与千问平台（DashScope 协议，wan 系列文生视频模型）。耗时可能达数分钟。调用前按会话权限模式审批（默认每次询问），批准前会展示保存路径。生成可能产生费用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "视频内容描述，包含主体动作与镜头运动" },
                "path": { "type": "string", "description": "保存目标的绝对路径，扩展名须为 mp4/webm/mov，父目录必须已存在" },
                "duration": { "type": "integer", "description": "可选：视频时长（秒），默认 5，范围 2-30，仅千问协议生效" },
                "resolution": { "type": "string", "description": "可选：分辨率档位 480P/720P/1080P，默认 720P，仅千问协议 wan3.0/wan2.7 模型生效" },
                "ratio": { "type": "string", "description": "可选：画面比例，如 16:9、9:16、1:1，默认 16:9，仅千问协议 wan3.0/wan2.7 模型生效" },
                "size": { "type": "string", "description": "可选：像素尺寸，如 1280*720，默认 1280*720，仅千问协议 wan2.6 及更早模型生效" }
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

pub fn image_video_spec() -> ToolSpec {
    ToolSpec {
        name: IMAGE_VIDEO_NAME.into(),
        description: "调用用户自行配置的千问平台（DashScope 协议）图生视频服务，以一张图片为首帧、按提示词生成一段视频并保存到本机指定路径。图片可以是公网 URL 或本机绝对路径（png/jpg/jpeg/webp/bmp，不超过 10 MiB）。耗时可能达数分钟。调用前按会话权限模式审批（默认每次询问），批准前会展示保存路径。生成可能产生费用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "视频内容描述，说明首帧画面之后主体的动作与镜头运动" },
                "image": { "type": "string", "description": "首帧图片：公网 HTTP(S) URL，或本机图片文件的绝对路径" },
                "path": { "type": "string", "description": "保存目标的绝对路径，扩展名须为 mp4/webm/mov，父目录必须已存在" },
                "duration": { "type": "integer", "description": "可选：视频时长（秒），默认 5，范围 2-30" },
                "resolution": { "type": "string", "description": "可选：分辨率档位 480P/720P/1080P，默认 720P；输出宽高比跟随首帧图片" }
            },
            "required": ["prompt", "image", "path"],
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

fn configured_model(value: Option<&String>, default: &str) -> String {
    value
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .unwrap_or(default)
        .to_string()
}

/// The 千问 platform exposes two prefixes under one host: the OpenAI-compatible
/// `/compatible-mode/v1` (used for images and chat) and the native `/api/v1`
/// (async video tasks). Users configure the compatible prefix, matching their
/// chat provider; the native prefix is derived from it.
fn dashscope_api_base(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if let Some(root) = trimmed.strip_suffix("/compatible-mode/v1") {
        return Ok(format!("{root}/api/v1"));
    }
    if trimmed.ends_with("/api/v1") {
        return Ok(trimmed.to_string());
    }
    Err("千问协议的服务地址应以 /compatible-mode/v1 或 /api/v1 结尾，例如 https://maas.qianwenaiapi.com/compatible-mode/v1".into())
}

fn duration_arg(arguments: &Value) -> u64 {
    arguments
        .get("duration")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(2, 30)
}

fn dashscope_error_detail(parsed: &Value) -> String {
    let code = parsed.get("code").and_then(Value::as_str).unwrap_or("");
    let message = parsed
        .pointer("/output/message")
        .or_else(|| parsed.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("");
    match (code.is_empty(), message.is_empty()) {
        (true, true) => String::new(),
        (true, false) => format!("：{message}"),
        (false, true) => format!("：{code}"),
        (false, false) => format!("：{code} {message}"),
    }
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
    if config.protocol == MediaProtocol::Dashscope {
        return run_image_dashscope(prompt, size, &target, config, key, http).await;
    }
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
    let parsed: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!(
            "图像服务返回 HTTP {}，未生成图片{}。",
            response.status,
            dashscope_error_detail(&parsed)
        ));
    }
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
        // 前端媒体预览依赖此固定文案解析保存路径，修改格式需同步 tool-call-part。
        Ok(()) => ToolOutcome::ok(format!(
            "已生成图像并保存到 {}（{} 字节）。",
            target.display(),
            bytes.len()
        )),
        Err(message) => ToolOutcome::error(message),
    }
}

/// 千问平台（含 Token Plan）的图像生成走 DashScope 原生同步接口，
/// 而非 OpenAI 兼容 images/generations；Token Plan 主机只支持前者。
async fn run_image_dashscope(
    prompt: &str,
    size: &str,
    target: &Path,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ToolOutcome {
    let api_base = match dashscope_api_base(&config.base_url) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let endpoint = match validation::endpoint(
        &api_base,
        "services/aigc/multimodal-generation/generation",
    ) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let model = configured_model(config.image_model.as_ref(), DEFAULT_IMAGE_MODEL);
    let body = json!({
        "model": model,
        "input": { "messages": [{ "role": "user", "content": [{ "text": prompt }] }] },
        "parameters": { "size": size.replace(['x', 'X'], "*"), "n": 1 }
    });
    let response = match http
        .post_json_capped(endpoint.as_str(), &body, key, MAX_RESPONSE)
        .await
    {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    let parsed: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!(
            "图像服务返回 HTTP {}，未生成图片{}。",
            response.status,
            dashscope_error_detail(&parsed)
        ));
    }
    let url = parsed
        .pointer("/output/choices/0/message/content")
        .and_then(Value::as_array)
        .and_then(|list| {
            list.iter()
                .find_map(|item| item.get("image").and_then(Value::as_str))
        })
        .filter(|value| !value.is_empty());
    let Some(url) = url else {
        return ToolOutcome::error(format!(
            "图像服务未返回图片数据{}。",
            dashscope_error_detail(&parsed)
        ));
    };
    if let Err(message) = validation::validate_tool_url(url) {
        return ToolOutcome::error(message);
    }
    let download = match http.get_capped(url, MAX_IMAGE_BYTES).await {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    if !(200..300).contains(&download.status) {
        return ToolOutcome::error(format!("下载图片返回 HTTP {}。", download.status));
    }
    if download.body.len() > MAX_IMAGE_BYTES {
        return ToolOutcome::error("图片超过 20 MiB，已拒绝保存。");
    }
    match save_bytes(target, &download.body) {
        // 前端媒体预览依赖此固定文案解析保存路径，修改格式需同步 media-result。
        Ok(()) => ToolOutcome::ok(format!(
            "已生成图像并保存到 {}（{} 字节）。",
            target.display(),
            download.body.len()
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
    match config.protocol {
        MediaProtocol::Dashscope => {
            let model = configured_model(config.video_model.as_ref(), DEFAULT_VIDEO_MODEL);
            let body = json!({
                "model": model,
                "input": { "prompt": prompt },
                "parameters": dashscope_video_parameters(&model, arguments)
            });
            run_dashscope_video(&body, config, key, http, &target).await
        }
        MediaProtocol::Openai => run_video_openai(prompt, &target, config, key, http).await,
    }
}

/// wan3.0/wan2.7 take resolution tiers plus an explicit ratio; wan2.6 and
/// earlier take a pixel size instead.
fn dashscope_video_parameters(model: &str, arguments: &Value) -> Value {
    let duration = duration_arg(arguments);
    if model.starts_with("wan3.0") || model.starts_with("wan2.7") {
        json!({
            "resolution": arguments.get("resolution").and_then(Value::as_str).unwrap_or("720P"),
            "ratio": arguments.get("ratio").and_then(Value::as_str).unwrap_or("16:9"),
            "duration": duration,
            "prompt_extend": true
        })
    } else {
        json!({
            "size": arguments.get("size").and_then(Value::as_str).unwrap_or("1280*720"),
            "duration": duration,
            "prompt_extend": true
        })
    }
}

async fn run_video_openai(
    prompt: &str,
    target: &Path,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ToolOutcome {
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
                return download_video(&parsed, target, http).await;
            }
            "failed" | "error" | "cancelled" | "canceled" => {
                return ToolOutcome::error(format!("视频生成失败，服务状态：{status}。"));
            }
            _ => continue,
        }
    }
    ToolOutcome::error("视频生成超过 5 分钟仍未完成，已停止等待；可稍后用同一服务查询。")
}

pub async fn run_video_from_image(
    arguments: &Value,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
) -> ToolOutcome {
    if config.protocol != MediaProtocol::Dashscope {
        return ToolOutcome::error("图生视频需要千问平台（DashScope 协议）服务，请在设置中切换协议。");
    }
    let Some(prompt) = arguments.get("prompt").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 prompt 参数，或它不是字符串。");
    };
    let Some(image) = arguments.get("image").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 image 参数，或它不是字符串。");
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
    let image_url = match resolve_input_image(image.trim()) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let model = configured_model(
        config.image_to_video_model.as_ref(),
        DEFAULT_IMAGE_VIDEO_MODEL,
    );
    let mut input = json!({ "prompt": prompt });
    // wan2.7/wan3.0 用 media 数组描述首帧；wan2.6/2.5 用 img_url 字段。
    if model.starts_with("wan2.7") || model.starts_with("wan3.0") {
        input["media"] = json!([{ "type": "first_frame", "url": image_url }]);
    } else {
        input["img_url"] = json!(image_url);
    }
    let body = json!({
        "model": model,
        "input": input,
        "parameters": {
            "resolution": arguments.get("resolution").and_then(Value::as_str).unwrap_or("720P"),
            "duration": duration_arg(arguments),
            "prompt_extend": true
        }
    });
    run_dashscope_video(&body, config, key, http, &target).await
}

/// Accepts a public URL verbatim, or reads a local image into a base64 data
/// URL (the DashScope HTTP API accepts both; local paths are SDK-only).
fn resolve_input_image(image: &str) -> Result<String, String> {
    if image.is_empty() {
        return Err("首帧图片不能为空。".into());
    }
    if image.starts_with("http://") || image.starts_with("https://") {
        validation::validate_tool_url(image)?;
        return Ok(image.to_string());
    }
    let (canonical, size) = file::resolve(image)?;
    if size > MAX_INPUT_IMAGE_BYTES {
        return Err("首帧图片超过 10 MiB，已拒绝使用。".into());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return Err("首帧图片仅支持 png/jpg/jpeg/webp/bmp。".into()),
    };
    let bytes = std::fs::read(&canonical).map_err(|_| "读取首帧图片失败。".to_string())?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

async fn run_dashscope_video(
    body: &Value,
    config: &MediaService,
    key: Option<&str>,
    http: &GuardedHttp,
    target: &Path,
) -> ToolOutcome {
    let api_base = match dashscope_api_base(&config.base_url) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let create_endpoint = match validation::endpoint(
        &api_base,
        "services/aigc/video-generation/video-synthesis",
    ) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    let response = match http
        .post_json_headers_capped(
            create_endpoint.as_str(),
            body,
            key,
            &[("X-DashScope-Async", "enable")],
            MAX_RESPONSE,
        )
        .await
    {
        Ok(value) => value,
        Err(error) => return ToolOutcome::error(error.message()),
    };
    let parsed: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    if !(200..300).contains(&response.status) {
        return ToolOutcome::error(format!(
            "视频服务返回 HTTP {}，未创建任务{}。",
            response.status,
            dashscope_error_detail(&parsed)
        ));
    }
    let Some(id) = parsed
        .pointer("/output/task_id")
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
    let poll_endpoint = match validation::endpoint(&api_base, &format!("tasks/{id}")) {
        Ok(value) => value,
        Err(message) => return ToolOutcome::error(message),
    };
    for poll in 0..DASHSCOPE_MAX_POLLS {
        if poll > 0 {
            tokio::time::sleep(VIDEO_POLL_INTERVAL).await;
        }
        let response = match http
            .get_auth_capped(poll_endpoint.as_str(), key, MAX_RESPONSE)
            .await
        {
            Ok(value) => value,
            Err(error) => return ToolOutcome::error(error.message()),
        };
        let parsed: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
        if !(200..300).contains(&response.status) {
            return ToolOutcome::error(format!(
                "查询视频进度返回 HTTP {}{}。",
                response.status,
                dashscope_error_detail(&parsed)
            ));
        }
        let status = parsed
            .pointer("/output/task_status")
            .and_then(Value::as_str)
            .unwrap_or("");
        match status {
            "SUCCEEDED" => {
                return download_video(&parsed, target, http).await;
            }
            "FAILED" | "CANCELED" | "UNKNOWN" => {
                return ToolOutcome::error(format!(
                    "视频生成失败，服务状态：{status}{}。",
                    dashscope_error_detail(&parsed)
                ));
            }
            _ => continue,
        }
    }
    ToolOutcome::error("视频生成超过 10 分钟仍未完成，已停止等待；任务 id 可在千问平台继续查询。")
}

async fn download_video(parsed: &Value, target: &Path, http: &GuardedHttp) -> ToolOutcome {
    let Some(url) = video_url(parsed) else {
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
    match save_bytes(target, &download.body) {
        // 前端媒体预览依赖此固定文案解析保存路径，修改格式需同步 tool-call-part。
        Ok(()) => ToolOutcome::ok(format!(
            "已生成视频并保存到 {}（{} 字节）。",
            target.display(),
            download.body.len()
        )),
        Err(message) => ToolOutcome::error(message),
    }
}

fn video_url(parsed: &Value) -> Option<String> {
    for pointer in [
        "/video_url",
        "/url",
        "/output/url",
        "/output/video_url",
        "/result/url",
        "/output/results/0/url",
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
            protocol: MediaProtocol::Openai,
            image_model: None,
            video_model: None,
            image_to_video_model: None,
        }
    }

    fn dashscope_config(base: &str) -> MediaService {
        MediaService {
            protocol: MediaProtocol::Dashscope,
            ..config(base)
        }
    }

    fn temp_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("niuery-tool-media-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn http_response(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn bytes_response(bytes: &[u8]) -> Vec<u8> {
        let mut raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        )
        .into_bytes();
        raw.extend_from_slice(bytes);
        raw
    }

    /// Serves one canned response per connection, in order, and records every
    /// request. `build` receives the base URL so bodies can link back to it.
    async fn sequence_mock(
        build: impl FnOnce(&str) -> Vec<Vec<u8>> + Send + 'static,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let base = format!("http://{address}/v1");
        let responses = build(&base);
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0u8; 8192];
                    let count = stream.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..count]);
                    if let Some(end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                stream.write_all(&response).await.unwrap();
            }
            requests
        });
        (base, task)
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
    async fn ai_assistant_tools_media_dashscope_image_downloads_url() {
        let (base, server) = sequence_mock(|base| {
            let host = base.trim_end_matches("/v1");
            vec![
                http_response(&format!(
                    "{{\"output\":{{\"choices\":[{{\"message\":{{\"content\":[{{\"image\":\"{host}/img.png\"}}]}}}}]}}}}"
                )),
                bytes_response(b"fake-png-url"),
            ]
        })
        .await;
        let root = temp_root();
        let target = root.join("out.png");
        let mut service = dashscope_config(&format!("{base}/compatible-mode/v1"));
        service.image_model = Some("qwen-image-3.0".into());
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_image(
            &json!({ "prompt": "一只猫", "path": target.to_str().unwrap(), "size": "1024x1024" }),
            &service,
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read(&target).unwrap(), b"fake-png-url");
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with(
            "POST /v1/api/v1/services/aigc/multimodal-generation/generation "
        ));
        assert!(requests[0].contains("\"model\":\"qwen-image-3.0\""));
        assert!(requests[0].contains("\"size\":\"1024*1024\""));
        assert!(requests[0].contains("\"text\":\"一只猫\""));
        assert!(requests[1].starts_with("GET /img.png "));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_dashscope_video_creates_and_polls_task() {
        let (base, server) = sequence_mock(|base| {
            let host = base.trim_end_matches("/v1");
            vec![
                http_response("{\"output\":{\"task_id\":\"task-1\",\"task_status\":\"PENDING\"}}"),
                http_response(&format!(
                    "{{\"output\":{{\"task_status\":\"SUCCEEDED\",\"video_url\":\"{host}/v.mp4\"}}}}"
                )),
                bytes_response(b"fake-video"),
            ]
        })
        .await;
        let root = temp_root();
        let target = root.join("out.mp4");
        let mut service = dashscope_config(&format!("{base}/compatible-mode/v1"));
        service.video_model = Some("wan2.6-t2v".into());
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_video(
            &json!({ "prompt": "一只猫在奔跑", "path": target.to_str().unwrap(), "duration": 5 }),
            &service,
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read(&target).unwrap(), b"fake-video");
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with(
            "POST /v1/api/v1/services/aigc/video-generation/video-synthesis "
        ));
        assert!(requests[0].to_lowercase().contains("x-dashscope-async: enable"));
        assert!(requests[0].contains("\"model\":\"wan2.6-t2v\""));
        assert!(requests[0].contains("\"size\":\"1280*720\""));
        assert!(requests[1].starts_with("GET /v1/api/v1/tasks/task-1 "));
        assert!(requests[1].to_lowercase().contains("authorization: bearer k"));
        assert!(requests[2].starts_with("GET /v.mp4 "));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_dashscope_video_wan30_uses_resolution_and_ratio() {
        let (base, server) = sequence_mock(|base| {
            let host = base.trim_end_matches("/v1");
            vec![
                http_response("{\"output\":{\"task_id\":\"task-2\",\"task_status\":\"PENDING\"}}"),
                http_response(&format!(
                    "{{\"output\":{{\"task_status\":\"SUCCEEDED\",\"video_url\":\"{host}/v.mp4\"}}}}"
                )),
                bytes_response(b"fake-video-30"),
            ]
        })
        .await;
        let root = temp_root();
        let target = root.join("out.mp4");
        let mut service = dashscope_config(&format!("{base}/compatible-mode/v1"));
        service.video_model = Some("wan3.0-video".into());
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_video(
            &json!({
                "prompt": "城市夜景",
                "path": target.to_str().unwrap(),
                "resolution": "1080P",
                "ratio": "9:16",
                "duration": 10
            }),
            &service,
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        let requests = server.await.unwrap();
        assert!(requests[0].contains("\"resolution\":\"1080P\""));
        assert!(requests[0].contains("\"ratio\":\"9:16\""));
        assert!(requests[0].contains("\"duration\":10"));
        assert!(!requests[0].contains("\"size\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_dashscope_i2v_encodes_local_image() {
        use base64::Engine;
        let (base, server) = sequence_mock(|base| {
            let host = base.trim_end_matches("/v1");
            vec![
                http_response("{\"output\":{\"task_id\":\"task-3\",\"task_status\":\"PENDING\"}}"),
                http_response(&format!(
                    "{{\"output\":{{\"task_status\":\"SUCCEEDED\",\"video_url\":\"{host}/v.mp4\"}}}}"
                )),
                bytes_response(b"fake-i2v"),
            ]
        })
        .await;
        let root = temp_root();
        let input = root.join("first.png");
        std::fs::write(&input, b"local-image-bytes").unwrap();
        let target = root.join("out.mp4");
        let service = dashscope_config(&format!("{base}/compatible-mode/v1"));
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_video_from_image(
            &json!({
                "prompt": "让画面动起来",
                "image": input.to_str().unwrap(),
                "path": target.to_str().unwrap()
            }),
            &service,
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        assert_eq!(std::fs::read(&target).unwrap(), b"fake-i2v");
        let requests = server.await.unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"local-image-bytes");
        assert!(requests[0].contains(&format!("\"img_url\":\"data:image/png;base64,{encoded}\"")));
        assert!(requests[0].contains("\"model\":\"wan2.6-i2v-flash\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_assistant_tools_media_dashscope_i2v_wan27_uses_media_array() {
        let (base, server) = sequence_mock(|base| {
            let host = base.trim_end_matches("/v1");
            vec![
                http_response("{\"output\":{\"task_id\":\"task-4\",\"task_status\":\"PENDING\"}}"),
                http_response(&format!(
                    "{{\"output\":{{\"task_status\":\"SUCCEEDED\",\"video_url\":\"{host}/v.mp4\"}}}}"
                )),
                bytes_response(b"fake-i2v-27"),
            ]
        })
        .await;
        let root = temp_root();
        let target = root.join("out.mp4");
        let mut service = dashscope_config(&format!("{base}/compatible-mode/v1"));
        service.image_to_video_model = Some("wan2.7-i2v".into());
        let http = GuardedHttp::for_tools().unwrap();
        let outcome = run_video_from_image(
            &json!({
                "prompt": "海龟游动",
                "image": "https://example.com/first.png",
                "path": target.to_str().unwrap()
            }),
            &service,
            Some("k"),
            &http,
        )
        .await;
        assert!(!outcome.is_error, "{}", outcome.content);
        let requests = server.await.unwrap();
        assert!(requests[0].contains("\"media\":[{\"type\":\"first_frame\",\"url\":\"https://example.com/first.png\"}]"));
        assert!(!requests[0].contains("img_url"));
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
        assert!(
            run_video_from_image(
                &json!({ "prompt": "x", "path": "C:/x.mp4" }),
                &service,
                None,
                &http
            )
            .await
            .is_error
        );
        let dashscope = dashscope_config("https://example.com/compatible-mode/v1");
        assert!(
            run_video_from_image(
                &json!({ "prompt": "x", "image": "https://example.com/a.png", "path": "C:/x.png" }),
                &dashscope,
                None,
                &http
            )
            .await
            .is_error
        );
    }

    #[test]
    fn ai_assistant_tools_media_dashscope_base_derivation() {
        assert_eq!(
            dashscope_api_base("https://maas.qianwenaiapi.com/compatible-mode/v1").unwrap(),
            "https://maas.qianwenaiapi.com/api/v1"
        );
        assert_eq!(
            dashscope_api_base("https://maas.qianwenaiapi.com/compatible-mode/v1/").unwrap(),
            "https://maas.qianwenaiapi.com/api/v1"
        );
        assert_eq!(
            dashscope_api_base("https://maas.qianwenaiapi.com/api/v1").unwrap(),
            "https://maas.qianwenaiapi.com/api/v1"
        );
        assert!(dashscope_api_base("https://maas.qianwenaiapi.com").is_err());
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
        assert_eq!(
            video_url(&json!({ "output": { "results": [{ "url": "https://c/v.mp4" }] } })),
            Some("https://c/v.mp4".into())
        );
        assert_eq!(video_url(&json!({})), None);
    }
}