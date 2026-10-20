use super::types::*;

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
    for model in &provider.models {
        if model.context_window == Some(0)
            || model.max_output_tokens == Some(0)
            || model
                .context_window
                .zip(model.max_output_tokens)
                .is_some_and(|(context, output)| output >= context)
            || model
                .output_token_parameter
                .as_deref()
                .is_some_and(|value| !matches!(value, "max_tokens" | "max_completion_tokens"))
        {
            return Err("模型容量或输出参数无效".into());
        }
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
