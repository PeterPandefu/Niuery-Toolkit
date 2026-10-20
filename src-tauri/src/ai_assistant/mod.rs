mod credentials;
mod engine;
mod storage;
mod types;
mod validation;
pub use types::*;

use futures_util::StreamExt;
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{ipc::Channel, Emitter, Manager, State};
use tokio::sync::watch;

#[derive(Default)]
pub struct AiState {
    storage: tokio::sync::Mutex<()>,
    active: Mutex<Option<Active>>,
    exit: Mutex<ExitState>,
}

struct Active {
    request_id: String,
    cancel: watch::Sender<bool>,
    completion: watch::Receiver<bool>,
}

#[derive(Default)]
struct ExitState {
    ready: bool,
    pending: Option<ExitAction>,
    permitted: bool,
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum ExitAction {
    Exit(i32),
    Restart,
}
enum ExitDecision {
    Allow,
    Prepare,
    Wait,
}
impl ExitState {
    fn prepare(&mut self, code: Option<i32>) -> ExitDecision {
        if self.permitted {
            self.permitted = false;
            return ExitDecision::Allow;
        }
        if self.pending.is_some() {
            return ExitDecision::Wait;
        }
        if !self.ready {
            return ExitDecision::Allow;
        }
        self.pending = Some(match code {
            Some(tauri::RESTART_EXIT_CODE) => ExitAction::Restart,
            _ => ExitAction::Exit(code.unwrap_or(0)),
        });
        ExitDecision::Prepare
    }
    fn complete(&mut self, success: bool) -> Option<ExitAction> {
        let code = self.pending.take();
        if success && code.is_some() {
            self.permitted = true;
            code
        } else {
            None
        }
    }
    fn set_ready(&mut self, ready: bool) -> bool {
        self.ready = ready;
        if !ready && self.pending.take().is_some() {
            self.permitted = false;
            return true;
        }
        false
    }
}

/// Tauri cannot prevent its restart exit code, and restart() can bypass all events
/// on the main thread. Ask the webview to save before requesting Tauri's restart.
pub fn request_restart(app: &tauri::AppHandle) {
    if !defer_exit(app, Some(tauri::RESTART_EXIT_CODE)) {
        app.request_restart();
    }
}

#[tauri::command]
pub fn ai_restart_application(app: tauri::AppHandle) {
    request_restart(&app);
}

pub fn has_exit_listener(app: &tauri::AppHandle) -> bool {
    let state = app.state::<AiState>();
    let result = state
        .exit
        .lock()
        .map(|exit| exit.ready || exit.pending.is_some())
        .unwrap_or(false);
    result
}

pub fn defer_exit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    let state = app.state::<AiState>();
    let decision = match state.exit.lock() {
        Ok(mut exit) => exit.prepare(code),
        Err(_) => return true,
    };
    match decision {
        ExitDecision::Allow => false,
        ExitDecision::Wait => true,
        ExitDecision::Prepare => {
            if app.emit_to("main", "ai-prepare-exit", ()).is_err() {
                if let Ok(mut exit) = state.exit.lock() {
                    exit.complete(false);
                }
                show_main(app);
            }
            true
        }
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn ai_set_exit_listener(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    ready: bool,
) -> Result<(), String> {
    let abandoned = state
        .exit
        .lock()
        .map_err(|_| "AI 退出状态不可用")?
        .set_ready(ready);
    if abandoned {
        show_main(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn ai_complete_exit(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    success: bool,
) -> Result<(), String> {
    let code = state
        .exit
        .lock()
        .map_err(|_| "AI 退出状态不可用")?
        .complete(success);
    if let Some(action) = code {
        match action {
            ExitAction::Exit(code) => app.exit(code),
            ExitAction::Restart => app.request_restart(),
        }
    } else if !success {
        show_main(&app);
    }
    Ok(())
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("ai-assistant"))
        .map_err(|_| "无法定位 AI 助手私有数据目录".into())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "AI 后台数据任务未完成".to_string())?
}

#[tauri::command]
pub async fn ai_load_workspace(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
) -> Result<Option<Workspace>, String> {
    let _guard = state.storage.lock().await;
    let root = directory(&app)?;
    blocking(move || storage::load(&root)).await
}

#[tauri::command]
pub async fn ai_save_workspace(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    workspace: Workspace,
) -> Result<(), String> {
    let _guard = state.storage.lock().await;
    let root = directory(&app)?;
    blocking(move || storage::save(&root, &workspace)).await
}

#[tauri::command]
pub async fn ai_save_provider(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    mut provider: Provider,
    api_key: Option<String>,
) -> Result<Provider, String> {
    validation::validate_provider(&mut provider)?;
    let _guard = state.storage.lock().await;
    let root = directory(&app)?;
    let namespace = app.config().identifier.clone();
    blocking(move || {
        let mut workspace = storage::load(&root)?.unwrap_or_else(Workspace::empty);
        let previous = workspace
            .providers
            .iter()
            .find(|item| item.id == provider.id)
            .cloned();
        let old_key = if api_key.is_some() || previous.as_ref().is_some_and(|p| p.has_api_key) {
            credentials::read(&namespace, &provider.id)?
        } else {
            None
        };
        if let Some(ref key) = api_key {
            if key.is_empty() {
                credentials::remove(&namespace, &provider.id)?;
            } else {
                credentials::write(&namespace, &provider.id, key)?;
            }
        }
        provider.has_api_key = match api_key.as_ref() {
            Some(key) => !key.is_empty(),
            None => old_key.is_some(),
        };
        workspace.providers.retain(|item| item.id != provider.id);
        workspace.providers.push(provider.clone());
        if let Err(error) = storage::save(&root, &workspace) {
            if api_key.is_some() {
                let rollback = match old_key {
                    Some(ref key) => credentials::write(&namespace, &provider.id, key),
                    None => credentials::remove(&namespace, &provider.id),
                };
                if rollback.is_err() {
                    return Err(format!("{error}；系统凭据回滚失败，请重新保存该服务配置"));
                }
            }
            return Err(error);
        }
        Ok(provider)
    })
    .await
}

#[tauri::command]
pub async fn ai_remove_provider(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    provider_id: String,
) -> Result<(), String> {
    storage::safe_id(&provider_id)?;
    let _guard = state.storage.lock().await;
    let root = directory(&app)?;
    let namespace = app.config().identifier.clone();
    blocking(move || {
        let mut workspace = storage::load(&root)?.unwrap_or_else(Workspace::empty);
        let old_key = if workspace
            .providers
            .iter()
            .any(|p| p.id == provider_id && p.has_api_key)
        {
            credentials::read(&namespace, &provider_id)?
        } else {
            None
        };
        // Remove even unreferenced keys left by an earlier interrupted operation on Windows.
        #[cfg(windows)]
        credentials::remove(&namespace, &provider_id)?;
        workspace.providers.retain(|item| item.id != provider_id);
        if let Err(error) = storage::save(&root, &workspace) {
            if let Some(key) = old_key {
                credentials::write(&namespace, &provider_id, &key)
                    .map_err(|_| format!("{error}；系统凭据恢复失败，请重新配置该服务"))?;
            }
            return Err(error);
        }
        Ok(())
    })
    .await
}

async fn provider(
    app: &tauri::AppHandle,
    state: &AiState,
    id: &str,
) -> Result<(Provider, Option<String>), String> {
    storage::safe_id(id)?;
    let _guard = state.storage.lock().await;
    let root = directory(app)?;
    let id = id.to_owned();
    let namespace = app.config().identifier.clone();
    blocking(move || {
        let workspace = storage::load(&root)?.ok_or("请先配置模型服务")?;
        let provider = workspace
            .providers
            .into_iter()
            .find(|p| p.id == id)
            .ok_or("模型服务已删除，请重新选择")?;
        if !provider.enabled {
            return Err("该模型服务已停用，请在设置中启用".into());
        }
        let key = if provider.has_api_key {
            Some(
                credentials::read(&namespace, &provider.id)?
                    .ok_or("系统凭据不存在，请重新保存 API Key")?,
            )
        } else {
            None
        };
        Ok((provider, key))
    })
    .await
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "无法初始化 AI 网络客户端".into())
}

fn status(response: &reqwest::Response) -> Result<(), String> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    Err(status_code(status.as_u16()))
}

fn status_code(status: u16) -> String {
    let message = match status {
        300..=399 => "模型服务返回了重定向。请直接配置最终服务地址，API Key 不会转发到重定向地址",
        401 | 403 => "服务鉴权失败，请检查 API Key 和访问权限",
        404 => "接口或模型不存在，请检查服务地址、协议和模型 ID；Ollama 需使用已安装的模型",
        408 | 504 => "模型服务响应超时，请稍后手动重试",
        413 => "消息或附件过大，请减少上下文或附件",
        429 => "模型服务限流或额度不足，请检查额度并稍后手动重试",
        400 | 422 => "模型拒绝了请求，请检查模型 ID、上下文长度、图片能力和模型参数",
        _ => "模型服务暂时不可用，请检查服务状态并手动重试",
    };
    format!("{message}（HTTP {status}）")
}

fn authorize(builder: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    match key {
        Some(value) => builder.bearer_auth(value),
        None => builder,
    }
}

async fn fetch_models(provider: &Provider, key: Option<&str>) -> Result<Vec<Model>, String> {
    let endpoint = if provider.kind == "ollama" {
        "api/tags"
    } else {
        "models"
    };
    let url = validation::endpoint(&provider.base_url, endpoint)?;
    let work = async {
        let response = authorize(client()?.get(url), key)
            .send()
            .await
            .map_err(|_| "连接模型服务失败，请检查地址、网络或本地 Ollama 服务".to_string())?;
        status(&response)?;
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "读取模型列表失败".to_string())?;
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err("模型列表响应过大".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "模型列表格式无效，请检查服务协议".to_string())?;
        let values = if provider.kind == "ollama" {
            value.get("models")
        } else {
            value.get("data")
        }
        .and_then(serde_json::Value::as_array)
        .ok_or("服务未返回有效模型列表，可手动添加模型 ID")?;
        let mut result = Vec::new();
        for item in values {
            let id = if provider.kind == "ollama" {
                item.get("name").or_else(|| item.get("model"))
            } else {
                item.get("id")
            }
            .and_then(serde_json::Value::as_str);
            if let Some(id) = id {
                if let Some(existing) = provider.models.iter().find(|model| model.id == id) {
                    result.push(existing.clone());
                    continue;
                }
                result.push(Model {
                    id: id.into(),
                    name: id.into(),
                    supports_images: provider
                        .models
                        .iter()
                        .any(|m| m.id == id && m.supports_images),
                    context_window: None,
                    max_output_tokens: None,
                    supports_temperature: None,
                    output_token_parameter: None,
                    stream_usage: None,
                    show_thinking: None,
                });
            }
        }
        Ok(result)
    };
    tokio::time::timeout(Duration::from_secs(60), work)
        .await
        .map_err(|_| "获取模型列表超时（60 秒）".to_string())?
}

#[tauri::command]
pub async fn ai_list_models(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    provider_id: String,
) -> Result<Vec<Model>, String> {
    let (provider, key) = provider(&app, &state, &provider_id).await?;
    fetch_models(&provider, key.as_deref()).await
}

#[tauri::command]
pub async fn ai_test_connection(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    provider_id: String,
) -> Result<String, String> {
    let (provider, key) = provider(&app, &state, &provider_id).await?;
    let models = fetch_models(&provider, key.as_deref()).await?;
    Ok(format!("连接成功，发现 {} 个模型", models.len()))
}

async fn test_model(
    provider: &Provider,
    key: Option<&str>,
    model_id: &str,
) -> Result<String, String> {
    if !provider.models.iter().any(|model| model.id == model_id) {
        return Err("请选择已启用模型".into());
    }
    let request: Request = serde_json::from_value(serde_json::json!({
        "requestId":nanoid::nanoid!(),"conversationId":"diagnostic","messageId":"diagnostic","providerId":provider.id,"modelId":model_id,
        "systemPrompt":"","parameters":{"historyRounds":0,"maxOutputTokens":16},
        "messages":[{"id":"diagnostic","role":"user","content":"Reply with OK.","attachments":[],"createdAt":0,"status":"complete"}]
    })).map_err(|_| "无法创建模型测试".to_string())?;
    let text_seen = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let seen = text_seen.clone();
    let channel = Channel::<StreamEvent>::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(value) = body {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&value) {
                if value["type"] == "delta"
                    && value["text"]
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty())
                {
                    seen.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }
        Ok(())
    });
    let (_sender, mut cancel) = watch::channel(false);
    let started = std::time::Instant::now();
    tokio::time::timeout(
        Duration::from_secs(60),
        stream_with_provider(provider, key, &request, &channel, &mut cancel),
    )
    .await
    .map_err(|_| "模型生成测试超时（60 秒）".to_string())??;
    if !text_seen.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("模型连接成功，但未返回可见正文，请检查模型能力和参数".into());
    }
    Ok(format!(
        "模型生成测试成功（{} ms），未发送会话历史",
        started.elapsed().as_millis()
    ))
}

#[tauri::command]
pub async fn ai_test_model(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    provider_id: String,
    model_id: String,
) -> Result<String, String> {
    let (provider, key) = provider(&app, &state, &provider_id).await?;
    test_model(&provider, key.as_deref(), &model_id).await
}

enum Outcome {
    Done,
    Stopped,
}

async fn stream_response(
    app: &tauri::AppHandle,
    state: &AiState,
    request: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Outcome, String> {
    let (provider, key) = tokio::select! {
        biased;
        _ = cancel.changed() => return Ok(Outcome::Stopped),
        result = provider(app, state, &request.provider_id) => result?,
    };
    stream_with_provider(&provider, key.as_deref(), request, channel, cancel).await
}

async fn stream_with_provider(
    provider: &Provider,
    key: Option<&str>,
    request: &Request,
    channel: &Channel<StreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Outcome, String> {
    engine::generate(provider, key, request, channel, cancel).await
}

#[tauri::command]
pub async fn ai_generate(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    request: Request,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let (sender, mut cancel) = watch::channel(false);
    let (completed, completion) = watch::channel(false);
    {
        let mut active = state.active.lock().map_err(|_| "AI 请求状态不可用")?;
        if active.is_some() {
            return on_event
                .send(request.event(
                    "error",
                    None,
                    Some("已有回复正在生成，请先停止当前生成".into()),
                ))
                .map_err(|_| "AI 页面连接已关闭".into());
        }
        *active = Some(Active {
            request_id: request.request_id.clone(),
            cancel: sender,
            completion,
        });
    }
    let outcome = stream_response(&app, &state, &request, &on_event, &mut cancel).await;
    let stopped = *cancel.borrow();
    if let Ok(mut active) = state.active.lock() {
        if active
            .as_ref()
            .is_some_and(|a| a.request_id == request.request_id)
        {
            *active = None;
        }
    }
    let event = if stopped {
        request.event("stopped", None, None)
    } else {
        match outcome {
            Ok(Outcome::Done) => request.event("done", None, None),
            Ok(Outcome::Stopped) => request.event("stopped", None, None),
            Err(error) => request.event("error", None, Some(error)),
        }
    };
    let result = on_event
        .send(event)
        .map_err(|_| "AI 页面连接已关闭，生成已结束".into());
    let _ = completed.send(true);
    result
}

async fn cancel_active_request(state: &AiState, request_id: &str) -> Result<(), String> {
    let completion = {
        let active = state.active.lock().map_err(|_| "AI 请求状态不可用")?;
        active
            .as_ref()
            .filter(|a| a.request_id == request_id)
            .map(|active| {
                let _ = active.cancel.send(true);
                active.completion.clone()
            })
    };
    if let Some(mut completion) = completion {
        while !*completion.borrow() {
            if completion.changed().await.is_err() {
                break;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_cancel(state: State<'_, AiState>, request_id: String) -> Result<(), String> {
    cancel_active_request(&state, &request_id).await
}

#[tauri::command]
pub async fn ai_open_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    let root = directory(&app)?;
    blocking(move || {
        std::fs::create_dir_all(&root).map_err(|_| "无法创建 AI 数据目录".to_string())?;
        tauri_plugin_opener::open_path(root, None::<&str>)
            .map_err(|_| "无法打开 AI 数据目录".into())
    })
    .await
}

#[tauri::command]
pub async fn ai_reset(app: tauri::AppHandle, state: State<'_, AiState>) -> Result<(), String> {
    if let Some(active) = state
        .active
        .lock()
        .map_err(|_| "AI 请求状态不可用")?
        .as_ref()
    {
        let _ = active.cancel.send(true);
        return Err("请先停止当前生成，再重置 AI 数据".into());
    }
    let _guard = state.storage.lock().await;
    let root = directory(&app)?;
    let namespace = app.config().identifier.clone();
    blocking(move || {
        // A damaged store may still have credentials. Windows enumerates our own prefix
        // so a reset never leaves keys merely because the JSON could not be parsed.
        credentials::remove_all(&namespace)?;
        storage::reset(&root)
    })
    .await
}

#[cfg(test)]
mod tests;
