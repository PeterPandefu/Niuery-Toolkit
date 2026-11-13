use super::{
    super::{tools, types::*, Outcome},
    request, ApprovalError, ApprovalRegistry, Consumed, APPROVAL_TIMEOUT,
};
use rig_core::message::{
    AssistantContent, AssistantMessage, Message, ToolCall, ToolResult, ToolResultContent,
};
use std::{collections::HashSet, sync::Arc};
use tauri::ipc::Channel;
use tokio::sync::watch;

/// Each round is one model request. Hitting the cap clears `tools` and asks once
/// more, so the user gets an answer instead of a bare error.
const MAX_ROUNDS: usize = 8;

pub async fn run(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    approvals: &ApprovalRegistry,
    env: &tools::ToolEnv,
    approval_channel: &Channel<StreamEvent>,
) -> Result<Outcome, String> {
    if *cancel.borrow() {
        return Ok(Outcome::Stopped);
    }
    let mut request = request::convert(input, provider, env)?;
    // Tool traffic never inherits a system or environment proxy.
    let http = super::transport::GuardedHttp::for_tools()?;
    // Only this request's user content counts as a trusted URL source.
    let corpus = tools::provenance::user_corpus(&input.messages);
    let mut search_urls: HashSet<String> = HashSet::new();
    let mut used = 0usize;
    loop {
        let consumed: Consumed =
            super::round(provider, key, input, &request, channel, cancel).await?;
        if matches!(consumed.outcome, Outcome::Stopped) {
            return Ok(Outcome::Stopped);
        }
        if consumed.calls.is_empty() {
            return Ok(Outcome::Done);
        }
        // The wrap-up round already ran tools-free; still asking for tools ends it.
        if request.tools.is_empty() {
            return Ok(Outcome::Done);
        }
        if used >= MAX_ROUNDS {
            request.tools.clear();
            emit_forced_finish(input, channel)?;
            continue;
        }
        used += 1;
        let Some((assistant, results)) = execute(
            provider,
            key,
            input,
            channel,
            approval_channel,
            cancel,
            approvals,
            &http,
            env,
            &corpus,
            &mut search_urls,
            &consumed.calls,
        )
        .await?
        else {
            return Ok(Outcome::Stopped);
        };
        request.chat_history.push(Arc::new(assistant));
        request
            .chat_history
            .push(Arc::new(Message::tool_results(results)));
    }
}

/// Calls run one at a time so each gets its own approval and its own URL check.
#[allow(clippy::too_many_arguments)]
async fn execute(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    channel: &Channel<StreamEvent>,
    approval_channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    approvals: &ApprovalRegistry,
    http: &super::transport::GuardedHttp,
    env: &tools::ToolEnv,
    corpus: &[String],
    search_urls: &mut HashSet<String>,
    calls: &[ToolCall],
) -> Result<Option<(Message, Vec<ToolResult>)>, String> {
    let mut content = Vec::new();
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for call in calls {
        if *cancel.borrow() {
            return Ok(None);
        }
        let id = call.id.wire().into_owned();
        let name = call.function.name.as_str().to_string();
        let arguments = serde_json::Value::Object(call.function.arguments.clone());
        let outcome = if !seen.insert(id.clone()) {
            tools::ToolOutcome::error("调用标识重复，已拒绝执行。")
        } else {
            match tools::approval_of(&name) {
                Some(tools::ApprovalLevel::Auto) => {
                    tools::execute(&name, &arguments, http, env).await
                }
                Some(tools::ApprovalLevel::Approve) => {
                    if name == tools::ask::NAME {
                        let mut event = input.event("question_required", None, None);
                        event.call_id = Some(id.clone());
                        event.name = Some(name.clone());
                        event.arguments = Some(arguments.to_string());
                        event.text = arguments
                            .get("question")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string);
                        match approvals
                            .ask(
                                &input.request_id,
                                &id,
                                event,
                                approval_channel,
                                cancel,
                                APPROVAL_TIMEOUT,
                            )
                            .await
                        {
                            Ok(answer) if answer.trim().is_empty() => {
                                tools::ToolOutcome::error("用户未提供回答。")
                            }
                            Ok(answer) => tools::ToolOutcome::ok(format!("用户回答：{answer}")),
                            Err(ApprovalError::Stopped) => return Ok(None),
                            Err(ApprovalError::Unavailable) => {
                                return Err("AI 页面连接已关闭，生成已结束".into());
                            }
                        }
                    } else {
                        let fs_tool = tools::is_path_tool(&name);
                        let preview = if fs_tool {
                            tools::file_preview(&name, &arguments)
                        } else {
                            None
                        };
                        // An unresolvable path touches nothing, so ask no approval
                        // and let the tool report the error to the model.
                        if fs_tool && preview.is_none() {
                            tools::execute(&name, &arguments, http, env).await
                        } else {
                            let mut event = input.event("approval_required", None, None);
                            event.call_id = Some(id.clone());
                            event.name = Some(name.clone());
                            event.arguments = Some(arguments.to_string());
                            if let Some((path, size)) = preview {
                                event.file_path = Some(path);
                                event.file_size = Some(size);
                            }
                            // Re-classified on every call; never cached across calls.
                            if let Some(url) =
                                arguments.get("url").and_then(serde_json::Value::as_str)
                            {
                                event.provenance = Some(
                                    tools::provenance::classify(url, corpus, search_urls)
                                        .as_str()
                                        .to_string(),
                                );
                                event.url = Some(url.to_string());
                            }
                            match approvals
                                .request(
                                    &input.request_id,
                                    &id,
                                    event,
                                    approval_channel,
                                    cancel,
                                    APPROVAL_TIMEOUT,
                                )
                                .await
                            {
                                Ok(ToolDecision::Approved) => {
                                    if name == tools::subagent::NAME {
                                        let prompt = arguments
                                            .get("prompt")
                                            .and_then(serde_json::Value::as_str)
                                            .unwrap_or("");
                                        super::subagent::run(
                                            provider,
                                            key,
                                            input,
                                            approval_channel,
                                            cancel,
                                            approvals,
                                            env,
                                            prompt,
                                        )
                                        .await
                                    } else {
                                        tools::execute(&name, &arguments, http, env).await
                                    }
                                }
                                Ok(ToolDecision::Rejected) => {
                                    tools::ToolOutcome::error("用户拒绝了此次调用。")
                                }
                                Err(ApprovalError::Stopped) => return Ok(None),
                                Err(ApprovalError::Unavailable) => {
                                    return Err("AI 页面连接已关闭，生成已结束".into());
                                }
                            }
                        }
                    }
                }
                None => tools::ToolOutcome::error("未知工具，已拒绝执行。"),
            }
        };
        // Only this task's own search results become a trusted source later on.
        search_urls.extend(outcome.discovered_urls.iter().cloned());
        emit_result(input, channel, call, &outcome)?;
        results.push(ToolResult {
            call: call.id.clone(),
            name: call.function.name.clone(),
            content: vec![ToolResultContent::text(tools::wrap_result(
                &name,
                &id,
                &outcome.content,
            ))],
            is_error: outcome.is_error,
        });
        content.push(AssistantContent::ToolCall(call.clone()));
    }
    Ok(Some((
        Message::Assistant(AssistantMessage::new(content)),
        results,
    )))
}

fn emit_result(
    input: &Request,
    channel: &Channel<StreamEvent>,
    call: &ToolCall,
    outcome: &tools::ToolOutcome,
) -> Result<(), String> {
    let mut event = input.event("tool_result", None, None);
    event.call_id = Some(call.id.wire().into_owned());
    event.name = Some(call.function.name.as_str().to_string());
    event.status = Some(
        if outcome.is_error {
            "failed"
        } else {
            "complete"
        }
        .into(),
    );
    if outcome.is_error {
        event.error = Some(outcome.content.clone());
    } else {
        event.result = Some(outcome.content.clone());
    }
    channel
        .send(event)
        .map_err(|_| "AI 页面连接已关闭".to_string())
}

fn emit_forced_finish(input: &Request, channel: &Channel<StreamEvent>) -> Result<(), String> {
    let mut event = input.event("metadata", None, None);
    event.forced_finish = Some(true);
    channel
        .send(event)
        .map_err(|_| "AI 页面连接已关闭".to_string())
}
