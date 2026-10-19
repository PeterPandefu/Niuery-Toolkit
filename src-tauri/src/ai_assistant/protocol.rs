use super::types::*;
use serde_json::{json, Value};

pub fn endpoint(base: &str, suffix: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base.trim())
        .map_err(|_| "服务地址无效，请填写完整的 HTTP 或 HTTPS 地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("服务地址仅支持 HTTP / HTTPS，不能包含用户名、密码、查询参数或片段".into());
    }
    let path = format!(
        "{}/{}",
        url.path().trim_end_matches('/'),
        suffix.trim_start_matches('/')
    );
    url.set_path(&path);
    Ok(url)
}

pub fn validate_provider(provider: &mut Provider) -> Result<(), String> {
    super::storage::safe_id(&provider.id)?;
    if !matches!(provider.kind.as_str(), "openai" | "ollama") {
        return Err("不支持的模型服务类型".into());
    }
    endpoint(&provider.base_url, "")?;
    provider.base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    if provider.name.trim().is_empty() {
        return Err("请填写服务名称".into());
    }
    Ok(())
}

pub fn validate_attachments(attachments: &[Attachment]) -> Result<(), String> {
    use base64::Engine;
    let mut images = 0;
    let mut texts = 0;
    let mut chars = 0;
    for item in attachments {
        super::storage::safe_id(&item.id)?;
        match item.kind.as_str() {
            "image" => {
                images += 1;
                if !matches!(
                    item.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                ) || item.size > 10 * 1024 * 1024
                    || item.data.len() > 14 * 1024 * 1024
                {
                    return Err("图片仅支持 PNG、JPEG、WebP，每张最多 10 MiB".into());
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&item.data)
                    .map_err(|_| "图片数据编码无效".to_string())?;
                if bytes.len() as u64 != item.size {
                    return Err("图片大小与附件元数据不一致".into());
                }
                let detected =
                    image::guess_format(&bytes).map_err(|_| "图片文件内容无效".to_string())?;
                let expected = match item.mime_type.as_str() {
                    "image/png" => image::ImageFormat::Png,
                    "image/jpeg" => image::ImageFormat::Jpeg,
                    _ => image::ImageFormat::WebP,
                };
                if detected != expected {
                    return Err("图片内容与声明的格式不一致".into());
                }
            }
            "text" => {
                texts += 1;
                chars += item.data.chars().count();
                let extension = item.name.rsplit('.').next().unwrap_or("").to_lowercase();
                const EXTENSIONS: &str = "txt text md markdown json jsonl log csv tsv xml yaml yml toml ini conf config env html htm css scss sass less js jsx ts tsx mjs cjs vue svelte astro py pyi rb php java kt kts c h cc cpp cxx hpp cs fs fsx go rs swift sh bash zsh ps1 psm1 bat cmd sql graphql gql r lua pl dart dockerfile makefile gitignore";
                if !EXTENSIONS.split(' ').any(|allowed| allowed == extension) {
                    return Err(
                        "文本附件仅支持纯文本和常见代码文件，不支持 PDF、Word 等文档".into(),
                    );
                }
                if item.size > 1024 * 1024
                    || item.data.len() > 1024 * 1024
                    || item
                        .data
                        .bytes()
                        .any(|byte| byte < 32 && !matches!(byte, 9 | 10 | 13))
                {
                    return Err("文本附件最多 1 MiB，且必须是 UTF-8 纯文本".into());
                }
            }
            _ => return Err("不支持的附件类型".into()),
        }
    }
    if images > 4 || texts > 5 || chars > 200_000 {
        return Err("每条消息最多 4 张图片、5 个文本文件，文本总计最多 200,000 字符".into());
    }
    Ok(())
}

pub fn payload(request: &Request, provider: &Provider) -> Result<Value, String> {
    if request.model_id.trim().is_empty() {
        return Err("请选择模型".into());
    }
    if request.parameters.history_rounds > 100
        || request
            .parameters
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
        || request.parameters.max_output_tokens == Some(0)
    {
        return Err("模型参数无效".into());
    }
    let mut messages = Vec::new();
    if !request.system_prompt.is_empty() {
        messages.push(json!({"role":"system","content":request.system_prompt}));
    }
    for message in &request.messages {
        if !matches!(message.role.as_str(), "user" | "assistant") {
            return Err("消息角色无效".into());
        }
        if message.role == "assistant" && message.status != "complete" {
            return Err("未完成的助手消息不能自动发送到模型".into());
        }
        validate_attachments(&message.attachments)?;
        let mut text = message.content.clone();
        for attachment in message.attachments.iter().filter(|a| a.kind == "text") {
            // JSON quoted names and explicit boundaries make file content data, never executable instructions.
            let name = serde_json::to_string(&attachment.name).unwrap_or_default();
            text.push_str(&format!(
                "\n\n<attached_file name={name}>\n{}\n</attached_file>",
                attachment.data
            ));
        }
        let images: Vec<_> = message
            .attachments
            .iter()
            .filter(|a| a.kind == "image")
            .collect();
        if !images.is_empty()
            && !provider
                .models
                .iter()
                .any(|m| m.id == request.model_id && m.supports_images)
        {
            return Err("当前模型未声明支持图片，请选择图片模型或减少包含图片的上下文".into());
        }
        if provider.kind == "ollama" {
            let mut value = json!({"role":message.role,"content":text});
            if !images.is_empty() {
                value["images"] = json!(images.iter().map(|a| &a.data).collect::<Vec<_>>());
            }
            messages.push(value);
        } else if images.is_empty() {
            messages.push(json!({"role":message.role,"content":text}));
        } else {
            let mut content = vec![json!({"type":"text","text":text})];
            for image in images {
                content.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}", image.mime_type, image.data)}}));
            }
            messages.push(json!({"role":message.role,"content":content}));
        }
    }
    let mut body = json!({"model":request.model_id,"messages":messages,"stream":true});
    if provider.kind == "ollama" {
        let mut options = json!({});
        if let Some(value) = request.parameters.temperature {
            options["temperature"] = json!(value);
        }
        if let Some(value) = request.parameters.max_output_tokens {
            options["num_predict"] = json!(value);
        }
        if options.as_object().is_some_and(|o| !o.is_empty()) {
            body["options"] = options;
        }
    } else {
        if let Some(value) = request.parameters.temperature {
            body["temperature"] = json!(value);
        }
        if let Some(value) = request.parameters.max_output_tokens {
            body["max_tokens"] = json!(value);
        }
    }
    Ok(body)
}

pub struct Decoder {
    buffer: Vec<u8>,
    sse_data: Vec<String>,
    ollama: bool,
    pub done: bool,
    pending_error: Option<String>,
}
impl Decoder {
    pub fn new(kind: &str) -> Self {
        Self {
            buffer: vec![],
            sse_data: vec![],
            ollama: kind == "ollama",
            done: false,
            pending_error: None,
        }
    }
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        if let Some(error) = self.pending_error.take() {
            return Err(error);
        }
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() > 16 * 1024 * 1024 {
            return Err("模型返回的单条流事件过大".into());
        }
        let mut result = Vec::new();
        while let Some(end) = self.buffer.iter().position(|b| *b == b'\n') {
            let bytes: Vec<_> = self.buffer.drain(..=end).collect();
            let line = match std::str::from_utf8(&bytes[..bytes.len() - 1]) {
                Ok(line) => line.trim_end_matches('\r'),
                Err(_) => return self.partial_error(result, "模型返回了无效的 UTF-8 内容".into()),
            };
            if let Err(error) = self.line(line, &mut result) {
                return self.partial_error(result, error);
            }
        }
        Ok(result)
    }
    fn line(&mut self, line: &str, result: &mut Vec<String>) -> Result<(), String> {
        if self.done {
            return Ok(());
        }
        if self.ollama {
            if !line.trim().is_empty() {
                self.parse(line, result)?;
            }
        } else if line.is_empty() {
            if !self.sse_data.is_empty() {
                let data = std::mem::take(&mut self.sse_data).join("\n");
                self.parse(&data, result)?;
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            self.sse_data
                .push(value.strip_prefix(' ').unwrap_or(value).to_string());
            if self.sse_data.iter().map(String::len).sum::<usize>() > 16 * 1024 * 1024 {
                return Err("模型返回的流事件过大".into());
            }
        }
        Ok(())
    }
    fn parse(&mut self, data: &str, result: &mut Vec<String>) -> Result<(), String> {
        if !self.ollama && data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|_| "模型流数据格式无效，请确认所选服务的协议".to_string())?;
        if value.get("error").is_some() {
            return Err("模型服务返回错误，请检查模型、上下文长度和参数后重试".into());
        }
        let content = if self.ollama {
            value.pointer("/message/content").and_then(Value::as_str)
        } else {
            value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
        };
        if let Some(text) = content {
            if !text.is_empty() {
                result.push(text.into());
            }
        }
        if self.ollama && value.get("done").and_then(Value::as_bool) == Some(true) {
            self.done = true;
        }
        Ok(())
    }
    pub fn finish(&mut self) -> Result<Vec<String>, String> {
        if let Some(error) = self.pending_error.take() {
            return Err(error);
        }
        let mut result = Vec::new();
        if !self.buffer.is_empty() {
            let bytes = std::mem::take(&mut self.buffer);
            let line = std::str::from_utf8(&bytes)
                .map_err(|_| "模型流在 UTF-8 字符中间断开".to_string())?;
            if let Err(error) = self.line(line.trim_end_matches('\r'), &mut result) {
                return self.partial_error(result, error);
            }
        }
        if !self.ollama {
            if let Err(error) = self.line("", &mut result) {
                return self.partial_error(result, error);
            }
        }
        if !self.done {
            return self.partial_error(
                result,
                "模型连接意外中断，未收到完成标志；已接收内容已保留，可重新生成".into(),
            );
        }
        Ok(result)
    }
    // Deliver successfully decoded tokens before the terminal error from this same batch.
    fn partial_error(&mut self, result: Vec<String>, error: String) -> Result<Vec<String>, String> {
        if result.is_empty() {
            return Err(error);
        }
        self.pending_error = Some(error);
        Ok(result)
    }
    pub fn take_error(&mut self) -> Option<String> {
        self.pending_error.take()
    }
}
