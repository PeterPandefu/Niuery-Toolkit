mod request;
mod transport;
mod wires;

use super::{types::*, Outcome};
use futures_util::StreamExt;
use rig_core::{
    completion::FinishReason,
    streaming::{CompletionStream, Item, StreamEvent as RigEvent},
};
use tauri::ipc::Channel;
use tokio::sync::watch;

pub async fn generate(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Outcome, String> {
    if *cancel.borrow() {
        return Ok(Outcome::Stopped);
    }
    let request = request::convert(input, provider)?;
    let http = transport::GuardedHttp::new()?;
    let fault = http.fault();
    let observed = wires::ObservedMetadata::default();
    let stream = wires::open(
        provider,
        key,
        &input.model_id,
        request,
        http,
        observed.clone(),
    )
    .map_err(|error| safe_error(&error))?;
    consume(stream, input, channel, cancel, observed)
        .await
        .map_err(|error| fault.message().unwrap_or(error))
}

async fn consume(
    mut stream: CompletionStream,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    observed: wires::ObservedMetadata,
) -> Result<Outcome, String> {
    let mut last_metadata = String::new();
    loop {
        if *cancel.borrow() {
            return Ok(Outcome::Stopped);
        }
        let item = tokio::select! { biased; _ = cancel.changed() => { emit_metadata(None, input, channel, &mut last_metadata, &observed)?; return Ok(Outcome::Stopped); }, item = stream.next() => item };
        emit_metadata(None, input, channel, &mut last_metadata, &observed)?;
        let Some(item) = item else {
            break;
        };
        match item.map_err(|error| safe_error(&error))? {
            Item::Event(RigEvent::Text { text, .. }) => channel
                .send(input.event("delta", Some(text), None))
                .map_err(|_| "AI 页面连接已关闭".to_string())?,
            Item::Event(RigEvent::Reasoning { text, .. }) => channel
                .send(input.event("thinking", Some(text), None))
                .map_err(|_| "AI 页面连接已关闭".to_string())?,
            // End repeats full part contents; never append them a second time.
            _ => {}
        }
    }
    let response = stream.finish().await.map_err(|error| safe_error(&error))?;
    emit_metadata(
        Some(&response),
        input,
        channel,
        &mut last_metadata,
        &observed,
    )?;
    Ok(Outcome::Done)
}

fn emit_metadata(
    response: Option<&rig_core::completion::CompletionResponse>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    last: &mut String,
    observed: &wires::ObservedMetadata,
) -> Result<(), String> {
    let mut event = input.event("metadata", None, None);
    if let Some(response) = response {
        event.finish_reason = response.finish_reason().map(|reason| match reason {
            FinishReason::Stop => "stop".into(),
            FinishReason::Length => "length".into(),
            FinishReason::ContentFilter => "content_filter".into(),
            FinishReason::ToolCalls => "tool_calls".into(),
            FinishReason::Other(value) => value,
            _ => "unknown".into(),
        });
        if let (Some(input_tokens), Some(output_tokens)) =
            (response.usage.input_tokens, response.usage.output_tokens)
        {
            event.usage = Some(Usage {
                input_tokens,
                output_tokens,
                total_tokens: response
                    .usage
                    .total_tokens
                    .unwrap_or(input_tokens.saturating_add(output_tokens)),
            });
        }
    }
    observed.apply(&mut event);
    let signature = serde_json::to_string(&event).map_err(|_| "模型元数据无效")?;
    if (event.finish_reason.is_some() || event.usage.is_some()) && *last != signature {
        channel
            .send(event)
            .map_err(|_| "AI 页面连接已关闭".to_string())?;
        *last = signature;
    }
    Ok(())
}

fn safe_error(error: &rig_core::error::ProviderError) -> String {
    if let Some(status) = error.provider_response_status() {
        return super::status_code(status.as_u16());
    }
    if matches!(error, rig_core::error::ProviderError::Truncated) {
        return "模型连接意外中断，未收到完成标志；已接收内容已保留".into();
    }
    // Provider bodies may echo secrets. Only fixed host-controlled messages reach IPC.
    "模型请求失败，请检查服务地址、网络、上下文及参数；已接收内容已保留，可手动重试。".into()
}

#[cfg(test)]
mod tests;
#[cfg(test)]
pub(super) use wires::payload_for_test;
