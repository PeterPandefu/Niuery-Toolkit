use super::{
    super::{tools, types::*, Outcome},
    request, ApprovalError, ApprovalRegistry, APPROVAL_TIMEOUT,
};
use rig_core::message::{
    AssistantContent, AssistantMessage, Message, ToolCall, ToolResult, ToolResultContent,
};
use std::{collections::HashSet, sync::Arc};
use tauri::ipc::Channel;
use tokio::sync::watch;

/// A content-inspection refusal invalidates only that round's output. The
/// recovery turn must wrap up from the results already gathered, skipping
/// whatever the provider refused, instead of failing the whole answer.
const RECOVERY_GUIDANCE: &str = "你上一条回复被模型服务的内容审查拦截，已作为无效结果丢弃。请基于已有的工具结果重新整理回答：跳过可能敏感或被拦截的信息，只整理其余可用内容；不要复述被拦截的内容，也不要提及本次拦截。";

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
    let mut inspection_retries = 0usize;
    let mut collected: Vec<(String, tools::ToolOutcome)> = Vec::new();
    loop {
        let consumed = match super::round(provider, key, input, &request, channel, cancel).await {
            Ok(consumed) => consumed,
            Err(error) if error.inspection => {
                // The blocked output is an invalid result: hide it and retry
                // once with a wrap-up that skips the refused content.
                channel
                    .send(input.event("round_reset", None, None))
                    .map_err(|_| "AI 页面连接已关闭".to_string())?;
                if inspection_retries == 0 {
                    inspection_retries += 1;
                    request.tools.clear();
                    request
                        .chat_history
                        .push(Arc::new(Message::user(RECOVERY_GUIDANCE)));
                    continue;
                }
                // Still refused: finish with the raw tool results so one
                // blocked summary never fails the whole answer.
                let fallback = fallback_answer(&collected);
                channel
                    .send(input.event("delta", Some(fallback), None))
                    .map_err(|_| "AI 页面连接已关闭".to_string())?;
                return Ok(Outcome::Done);
            }
            Err(error) => return Err(error.message),
        };
        if matches!(consumed.outcome, Outcome::Stopped) {
            return Ok(Outcome::Stopped);
        }
        if consumed.calls.is_empty() {
            return Ok(Outcome::Done);
        }
        // The wrap-up round already ran tools-free; still asking for tools ends
        // it, but every streamed call must settle so the UI never hangs.
        if request.tools.is_empty() {
            for call in &consumed.calls {
                emit_result(
                    input,
                    channel,
                    call,
                    &tools::ToolOutcome::error("收尾轮不再执行工具，此调用未执行。"),
                )?;
            }
            return Ok(Outcome::Done);
        }
        let Some((assistant, results, outcomes)) = execute(
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
        collected.extend(outcomes);
        request.chat_history.push(Arc::new(assistant));
        request
            .chat_history
            .push(Arc::new(Message::tool_results(results)));
    }
}

/// Last-resort answer when even the recovery turn is refused: the gathered
/// tool results, trimmed for readability, instead of a failed generation.
fn fallback_answer(collected: &[(String, tools::ToolOutcome)]) -> String {
    let mut text = String::from(
        "模型整理被模型服务的内容审查拦截，被拦截的输出已丢弃。以下为本次工具返回的原始结果：",
    );
    let mut any = false;
    for (name, outcome) in collected {
        if outcome.is_error {
            continue;
        }
        any = true;
        let snippet: String = outcome.content.chars().take(1500).collect();
        text.push_str(&format!("\n\n【{name}】\n{snippet}"));
    }
    if !any {
        text.push_str("\n（本次没有可用的工具结果，请调整提问内容或更换模型后重试。）");
    }
    text
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
) -> Result<Option<(Message, Vec<ToolResult>, Vec<(String, tools::ToolOutcome)>)>, String> {
    let mut content = Vec::new();
    let mut results = Vec::new();
    let mut plain = Vec::new();
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
                            // Re-classified on every call; never cached across calls.
                            let provenance = arguments
                                .get("url")
                                .and_then(serde_json::Value::as_str)
                                .map(|url| {
                                    tools::provenance::classify(url, corpus, search_urls).as_str()
                                });
                            let needs_approval = match input.permission_mode {
                                PermissionMode::Ask => true,
                                PermissionMode::Full => false,
                                PermissionMode::Auto => tools::auto_risk(&name, provenance),
                            };
                            if !needs_approval {
                                // Modes that skip the dialog still surface the exact
                                // URL and its source on the call record.
                                if let Some(url) =
                                    arguments.get("url").and_then(serde_json::Value::as_str)
                                {
                                    let mut event = input.event("tool_call", None, None);
                                    event.call_id = Some(id.clone());
                                    event.name = Some(name.clone());
                                    event.status = Some("pending".into());
                                    event.url = Some(url.to_string());
                                    event.provenance = provenance.map(str::to_string);
                                    channel
                                        .send(event)
                                        .map_err(|_| "AI 页面连接已关闭".to_string())?;
                                }
                                run_approved(
                                    provider,
                                    key,
                                    input,
                                    approval_channel,
                                    cancel,
                                    approvals,
                                    env,
                                    http,
                                    &name,
                                    &arguments,
                                )
                                .await
                            } else {
                                let mut event = input.event("approval_required", None, None);
                                event.call_id = Some(id.clone());
                                event.name = Some(name.clone());
                                event.arguments = Some(arguments.to_string());
                                if let Some((path, size)) = preview {
                                    event.file_path = Some(path);
                                    event.file_size = Some(size);
                                }
                                if let Some(url) =
                                    arguments.get("url").and_then(serde_json::Value::as_str)
                                {
                                    event.provenance = provenance.map(str::to_string);
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
                                        run_approved(
                                            provider,
                                            key,
                                            input,
                                            approval_channel,
                                            cancel,
                                            approvals,
                                            env,
                                            http,
                                            &name,
                                            &arguments,
                                        )
                                        .await
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
                }
                None => tools::ToolOutcome::error("未知工具，已拒绝执行。"),
            }
        };
        // Only this task's own search results become a trusted source later on.
        search_urls.extend(outcome.discovered_urls.iter().cloned());
        emit_result(input, channel, call, &outcome)?;
        plain.push((name.clone(), outcome.clone()));
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
        plain,
    )))
}

/// Execution shared by the approved and the approval-free paths, so a skipped
/// dialog never changes what a tool is allowed to do.
#[allow(clippy::too_many_arguments)]
async fn run_approved(
    provider: &Provider,
    key: Option<&str>,
    input: &Request,
    approval_channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
    approvals: &ApprovalRegistry,
    env: &tools::ToolEnv,
    http: &super::transport::GuardedHttp,
    name: &str,
    arguments: &serde_json::Value,
) -> tools::ToolOutcome {
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
        tools::execute(name, arguments, http, env).await
    }
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

