mod approval;
mod request;
mod rounds;
mod subagent;
pub(super) mod transport;
mod wires;

pub use approval::{ApprovalError, ApprovalRegistry, APPROVAL_TIMEOUT};

use super::{types::*, Outcome};
use futures_util::StreamExt;
use rig_core::{
    completion::{CompletionRequest, FinishReason},
    message::{AssistantContent, ToolCall},
    streaming::{CompletionStream, Item, StreamEvent as RigEvent},
};
use tauri::ipc::Channel;
use tokio::sync::watch;

/// The authoritative calls come from `stream.finish()`, whose reassembler has
/// already joined the argument fragments. `End` events only drive the UI.
pub struct Consumed {
    pub outcome: Outcome,
    pub calls: Vec<ToolCall>,
}

pub async fn generate(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    approvals: &ApprovalRegistry,
) -> Result<Outcome, String> {
    generate_with_tools(
        provider,
        key,
        input,
        channel,
        cancel,
        approvals,
        &super::tools::ToolEnv::default(),
    )
    .await
}

pub async fn generate_with_tools(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    approvals: &ApprovalRegistry,
    env: &super::tools::ToolEnv,
) -> Result<Outcome, String> {
    rounds::run(
        provider, key, input, channel, cancel, approvals, env, channel,
    )
    .await
}

/// One tool-free round for connectivity diagnostics: the probe must stay
/// byte-identical to a plain chat request, with no tool definitions attached.
pub async fn generate_diagnostic(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Outcome, String> {
    let mut request = request::convert(input, provider, &super::tools::ToolEnv::default())?;
    request.tools.clear();
    let consumed = round(provider, key, input, &request, channel, cancel).await?;
    Ok(consumed.outcome)
}

/// One model request within a task.
async fn round(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    request: &CompletionRequest,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Consumed, String> {
    if *cancel.borrow() {
        return Ok(stopped());
    }
    let http = transport::GuardedHttp::new()?;
    let fault = http.fault();
    let observed = wires::ObservedMetadata::default();
    let stream = wires::open(
        provider,
        key,
        &input.model_id,
        request.clone(),
        http,
        observed.clone(),
    )
    .map_err(|error| safe_error(&error))?;
    consume(stream, input, channel, cancel, observed)
        .await
        .map_err(|error| fault.message().unwrap_or(error))
}

fn stopped() -> Consumed {
    Consumed {
        outcome: Outcome::Stopped,
        calls: Vec::new(),
    }
}

fn emit_tool_call(
    input: &Request,
    channel: &Channel<StreamEvent>,
    call: &ToolCall,
) -> Result<(), String> {
    let mut event = input.event("tool_call", None, None);
    event.call_id = Some(call.id.wire().into_owned());
    event.name = Some(call.function.name.as_str().to_string());
    event.arguments =
        Some(serde_json::to_string(&call.function.arguments).map_err(|_| "工具调用参数无效")?);
    event.status = Some("pending".into());
    channel
        .send(event)
        .map_err(|_| "AI 页面连接已关闭".to_string())
}

async fn consume(
    mut stream: CompletionStream,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    observed: wires::ObservedMetadata,
) -> Result<Consumed, String> {
    let mut last_metadata = String::new();
    loop {
        if *cancel.borrow() {
            return Ok(stopped());
        }
        let item = tokio::select! { biased; _ = cancel.changed() => { emit_metadata(None, input, channel, &mut last_metadata, &observed)?; return Ok(stopped()); }, item = stream.next() => item };
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
            Item::Event(RigEvent::End {
                content: AssistantContent::ToolCall(call),
                ..
            }) => emit_tool_call(input, channel, &call)?,
            // Start and Arguments carry no call id, and End repeats full part
            // contents; neither is forwarded nor appended a second time.
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
    let calls = response
        .choice
        .iter()
        .filter_map(|part| match part {
            AssistantContent::ToolCall(call) => Some(call.clone()),
            _ => None,
        })
        .collect();
    Ok(Consumed {
        outcome: Outcome::Done,
        calls,
    })
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
