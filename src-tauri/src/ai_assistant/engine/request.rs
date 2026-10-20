use super::super::{types::*, validation};
use rig_core::{
    completion::CompletionRequest,
    message::{DocumentSourceKind, Image, ImageMediaType, Message, UserContent},
};

pub fn convert(input: &Request, provider: &Provider) -> Result<CompletionRequest, String> {
    if !provider.enabled || input.model_id.trim().is_empty() {
        return Err("请选择已启用模型服务和模型".into());
    }
    validation::validate_provider(&mut provider.clone())?;
    let model = provider
        .models
        .iter()
        .find(|model| model.id == input.model_id)
        .ok_or("请选择已启用模型")?;
    if input.parameters.history_rounds > 100
        || input
            .parameters
            .temperature
            .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
        || input.parameters.max_output_tokens == Some(0)
    {
        return Err("模型参数无效".into());
    }
    let mut messages = Vec::new();
    if !input.system_prompt.is_empty() {
        messages.push(Message::system(input.system_prompt.clone()));
    }
    for message in &input.messages {
        validation::validate_attachments(&message.attachments)?;
        if message.role == "assistant" && message.status != "complete" {
            return Err("未完成的助手消息不能自动发送到模型".into());
        }
        let mut text = message.content.clone();
        for file in message
            .attachments
            .iter()
            .filter(|file| file.kind == "text")
        {
            let name = serde_json::to_string(&file.name).map_err(|_| "附件名称无效")?;
            text.push_str(&format!(
                "\n\n<attached_file name={name}>\n{}\n</attached_file>",
                file.data
            ));
        }
        let next = match message.role.as_str() {
            "assistant" => Message::assistant(text),
            "user" => {
                let mut content = Vec::new();
                if !text.is_empty() {
                    content.push(UserContent::text(text));
                }
                for file in message
                    .attachments
                    .iter()
                    .filter(|file| file.kind == "image")
                {
                    if !model.supports_images {
                        return Err("当前模型未声明支持图片".into());
                    }
                    content.push(UserContent::Image(Image {
                        data: DocumentSourceKind::base64(file.data.clone()),
                        media_type: Some(match file.mime_type.as_str() {
                            "image/png" => ImageMediaType::PNG,
                            "image/jpeg" => ImageMediaType::JPEG,
                            _ => ImageMediaType::WEBP,
                        }),
                        ..Image::default()
                    }));
                }
                Message::User { content }
            }
            _ => return Err("消息角色无效".into()),
        };
        messages.push(next);
    }
    if messages.is_empty() {
        return Err("请输入消息".into());
    }
    let mut request = CompletionRequest::from(messages);
    request.temperature = input
        .parameters
        .temperature
        .filter(|_| model.supports_temperature != Some(false));
    request.max_tokens = input
        .parameters
        .max_output_tokens
        .map(|value| u64::from(value.min(model.max_output_tokens.unwrap_or(value))));
    request.record_telemetry_content = false;
    Ok(request)
}
