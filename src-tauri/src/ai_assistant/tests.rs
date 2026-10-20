use super::*;

#[test]
fn ai_assistant_rejects_invalid_model_capacity_metadata() {
    let mut provider = provider_at("http://localhost", "openai");
    provider.models[0].context_window = Some(0);
    assert!(validation::validate_provider(&mut provider).is_err());
    provider.models[0].context_window = Some(100);
    provider.models[0].max_output_tokens = Some(101);
    assert!(validation::validate_provider(&mut provider).is_err());
}

#[test]
fn ai_assistant_organization_metadata_survives_disk_reload() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let mut value = serde_json::to_value(workspace()).unwrap();
    value["templates"] = serde_json::json!([{"id":"t1","name":"Prompt","content":"Review {{input}}","favorite":true}]);
    value["conversations"][0]["pinned"] = serde_json::json!(true);
    value["conversations"][0]["archived"] = serde_json::json!(true);
    let workspace: Workspace = serde_json::from_value(value).unwrap();
    storage::save(&root, &workspace).unwrap();
    let restored = storage::load(&root).unwrap().unwrap();
    assert_eq!(restored.templates.unwrap()[0].content, "Review {{input}}");
    assert_eq!(restored.conversations[0].pinned, Some(true));
    assert_eq!(restored.conversations[0].archived, Some(true));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn ai_assistant_deep_features_survive_disk_reload_and_exported_pdf_text() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let mut value = serde_json::to_value(workspace()).unwrap();
    let message = serde_json::json!({"id":"a","role":"assistant","content":"Second","status":"complete","createdAt":2,"attachments":[],"usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30},"finishReason":"length","firstTokenMs":500,"durationMs":1000,"versions":[{"content":"First","createdAt":1,"status":"complete"},{"content":"Second","createdAt":2,"status":"complete"}],"selectedVersion":1});
    value["conversations"][0]["messages"] = serde_json::json!([message.clone()]);
    value["conversations"][0]["summary"] = serde_json::json!("Keep SQLite");
    value["conversations"][0]["parentConversationId"] = serde_json::json!("parent");
    value["conversations"][0]["tasks"] = serde_json::json!([{"id":"task","kind":"comparison","createdAt":1,"prompt":"Question","results":[{"label":"Model","target":"p:http://localhost","message":message}]}]);
    value["conversations"][0]["draftAttachments"][0]["sourceDocument"] =
        serde_json::json!({"name":"report.pdf","pages":1});
    value["conversations"][0]["draftAttachments"][0]["name"] = serde_json::json!("report.pdf.txt");
    let workspace: Workspace = serde_json::from_value(value).unwrap();
    storage::save(&root, &workspace).unwrap();
    let restored = storage::load(&root).unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(workspace).unwrap()
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn ai_assistant_model_diagnostic_uses_generation_without_conversation_history() {
    let (base, server) = mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n", false).await;
    assert!(test_model(
        &provider_at(&base, "openai"),
        Some("diagnostic-key"),
        "model"
    )
    .await
    .unwrap()
    .contains("成功"));
    let request = String::from_utf8(server.await.unwrap()).unwrap();
    assert!(request.starts_with("POST /v1/chat/completions"));
    assert!(request.contains("Reply with OK."));
    assert!(!request.contains("question"));
    let (base, server) = mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: [DONE]\n\n", false).await;
    assert!(test_model(&provider_at(&base, "openai"), None, "model")
        .await
        .unwrap_err()
        .contains("正文"));
    server.await.unwrap();
}

#[tokio::test]
async fn ai_assistant_stream_retains_finish_reason_and_actual_usage() {
    let (events, result) = stream_fixture("openai", "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: [DONE]\n\n").await;
    assert!(result.is_ok());
    assert_eq!(events.last().unwrap()["finishReason"], "length");
    assert_eq!(
        events
            .iter()
            .rev()
            .find(|event| event["type"] == "metadata")
            .unwrap()["usage"]["totalTokens"],
        30
    );
    let (events, result) = stream_fixture("ollama", "{\"message\":{\"content\":\"ok\"},\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":4,\"eval_count\":6}\n").await;
    assert!(result.is_ok());
    assert_eq!(
        events
            .iter()
            .rev()
            .find(|event| event["type"] == "metadata")
            .unwrap()["usage"]["totalTokens"],
        10
    );
}

#[tokio::test]
async fn ai_assistant_stream_extracts_thinking_separately_from_answer() {
    for (kind, body) in [
        ("openai", "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"plan\",\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n"),
        ("ollama", "{\"message\":{\"thinking\":\"plan\",\"content\":\"answer\"},\"done\":true}\n"),
    ] {
        let (events, result) = stream_fixture(kind, body).await;
        assert!(result.is_ok(), "{kind}: {:?}", result.err());
        assert_eq!(event_text(&events, "thinking"), "plan");
        assert_eq!(event_text(&events, "delta"), "answer");
    }
}

#[tokio::test]
async fn ai_assistant_thinking_survives_same_chunk_error_and_utf8_splits() {
    let (events, result) = stream_fixture("openai", "data: {\"choices\":[{\"delta\":{\"reasoning\":\"检查约束\"}}]}\n\ndata: {\"error\":\"failed\"}\n\n").await;
    assert!(result.is_err());
    assert_eq!(event_text(&events, "thinking"), "检查约束");
}

#[test]
fn ai_assistant_thinking_and_versions_survive_storage_without_request_replay() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let mut input = serde_json::to_value(workspace()).unwrap();
    input["conversations"][0]["messages"] = serde_json::json!([{"id":"a","role":"assistant","content":"answer","thinking":"thought","attachments":[],"createdAt":1,"status":"complete","versions":[{"content":"answer","thinking":"old thought","createdAt":1,"status":"complete"}]}]);
    let value: Workspace = serde_json::from_value(input).unwrap();
    storage::save(&root, &value).unwrap();
    let restored = storage::load(&root).unwrap().unwrap();
    assert_eq!(
        restored.conversations[0].messages[0].thinking.as_deref(),
        Some("thought")
    );
    let mut request = request();
    request.messages = restored.conversations[0].messages.clone();
    assert!(
        !engine::payload_for_test(&provider_at("http://localhost", "openai"), &request)
            .unwrap()
            .to_string()
            .contains("thought")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn ai_assistant_http_delivers_thinking_even_before_same_chunk_error() {
    let (base, server) = mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"reasoning_content\":\"preserved thought\"}}]}\n\ndata: {\"error\":\"failed\"}\n\n", false).await;
    let events = std::sync::Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            capture
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(&body).unwrap());
        }
        Ok(())
    });
    let (_sender, mut cancel) = watch::channel(false);
    assert!(stream_with_provider(
        &provider_at(&base, "openai"),
        None,
        &request(),
        &channel,
        &mut cancel
    )
    .await
    .is_err());
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["type"], "thinking");
    assert_eq!(events[0]["text"], "preserved thought");
    server.await.unwrap();
}

#[test]
fn ai_assistant_payload_honors_model_capabilities() {
    let mut provider = provider_at("http://localhost:11434", "openai");
    provider.models[0] = serde_json::from_value(serde_json::json!({"id":"model","name":"Model","supportsImages":false,"contextWindow":1000,"maxOutputTokens":20,"supportsTemperature":false,"outputTokenParameter":"max_completion_tokens","streamUsage":true})).unwrap();
    let mut input = request();
    input.parameters.temperature = Some(0.5);
    input.parameters.max_output_tokens = Some(30);
    let payload = engine::payload_for_test(&provider, &input).unwrap();
    assert_eq!(payload["max_completion_tokens"], 20);
    assert!(payload.get("max_tokens").is_none());
    assert!(payload.get("temperature").is_none());
    assert_eq!(payload["stream_options"]["include_usage"], true);
}

#[tokio::test]
async fn ai_assistant_streams_split_utf8_and_multiline_sse() {
    let (events, result) = stream_fixture(
        "openai",
        "data: {\"choices\":\ndata: [{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\n\n",
    )
    .await;
    assert!(result.is_ok());
    assert_eq!(event_text(&events, "delta"), "你好");
}

#[tokio::test]
async fn ai_assistant_ollama_requires_terminal_marker() {
    let (events, result) = stream_fixture(
        "ollama",
        "{\"message\":{\"content\":\"ok\"},\"done\":false}\n",
    )
    .await;
    assert!(result.is_err());
    assert_eq!(event_text(&events, "delta"), "ok");
    assert!(stream_fixture("ollama", "{\"done\":true}\n")
        .await
        .1
        .is_ok());
}

#[test]
fn ai_assistant_urls_preserve_configured_prefix_and_reject_secrets() {
    assert_eq!(
        validation::endpoint("https://example.com/custom/v1/", "chat/completions")
            .unwrap()
            .as_str(),
        "https://example.com/custom/v1/chat/completions"
    );
    assert!(validation::endpoint("https://user:pass@example.com/v1", "models").is_err());
    assert!(validation::endpoint("file:///tmp/key", "models").is_err());
    assert!(storage::safe_id("../escape").is_err());
    assert!(storage::safe_id("chat-123").is_ok());
}

fn workspace() -> Workspace {
    serde_json::from_value(serde_json::json!({"version":1,"providers":[],"assistants":[],"conversations":[{"id":"chat1","assistantId":"a1","title":"title","systemPrompt":"","parameters":{"historyRounds":20},"messages":[],"draft":"draft","draftAttachments":[{"id":"att1","name":"hello.txt","kind":"text","mimeType":"text/plain","size":5,"data":"hello"}],"approvedTargets":[],"updatedAt":1}],"activeAssistantId":"a1","activeConversationId":"chat1"})).unwrap()
}

#[test]
fn ai_assistant_storage_round_trip_backup_and_corruption_protection() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let value = workspace();
    storage::save(&root, &value).unwrap();
    assert_eq!(
        serde_json::to_value(storage::load(&root).unwrap().unwrap()).unwrap(),
        serde_json::to_value(&value).unwrap()
    );
    assert!(!std::fs::read_to_string(root.join("workspace.json"))
        .unwrap()
        .contains("hello"));
    std::fs::write(root.join("workspace.json"), "broken").unwrap();
    assert!(storage::load(&root).unwrap().is_some());
    assert_eq!(
        std::fs::read_to_string(root.join("workspace.json")).unwrap(),
        "broken"
    );
    std::fs::write(root.join("workspace.bak.json"), "broken too").unwrap();
    assert!(storage::load(&root).is_err());
    assert!(storage::save(&root, &value).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

pub(super) fn provider_at(base: &str, kind: &str) -> Provider {
    serde_json::from_value(serde_json::json!({"id":"p1","name":"Mock","kind":kind,"baseUrl":base,"hasApiKey":false,"models":[{"id":"model","name":"Model","supportsImages":false}],"enabled":true})).unwrap()
}

pub(super) fn request() -> Request {
    serde_json::from_value(serde_json::json!({"requestId":"r1","conversationId":"chat1","messageId":"reply1","providerId":"p1","modelId":"model","systemPrompt":"system","parameters":{"historyRounds":20},"messages":[{"id":"m1","role":"user","content":"question","attachments":[],"createdAt":1,"status":"complete"}]})).unwrap()
}

pub(super) async fn mock_server(
    response: &[u8],
    hold: bool,
) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response = response.to_vec();
    let task = tokio::spawn(async move {
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
            assert!(request.len() < 1024 * 1024);
        }
        stream.write_all(&response).await.unwrap();
        if hold {
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        request
    });
    (format!("http://{address}/v1"), task)
}

#[tokio::test]
async fn ai_assistant_redirect_never_forwards_key() {
    let (base, server) = mock_server(
        b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/steal\r\nContent-Length: 0\r\n\r\n",
        false,
    )
    .await;
    let error = fetch_models(&provider_at(&base, "openai"), Some("test-key-only"))
        .await
        .unwrap_err();
    assert!(error.contains("重定向"));
    let received = String::from_utf8(server.await.unwrap()).unwrap();
    assert!(received
        .to_lowercase()
        .contains("authorization: bearer test-key-only"));
}

#[tokio::test]
async fn ai_assistant_real_http_streams_and_cancel_waiting_body() {
    let (base, server) = mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n", false).await;
    let (sender, mut cancel) = watch::channel(false);
    let captured = std::sync::Arc::new(Mutex::new(Vec::new()));
    let capture = captured.clone();
    let channel = Channel::new(move |body| {
        capture.lock().unwrap().push(body);
        Ok(())
    });
    assert!(matches!(
        stream_with_provider(
            &provider_at(&base, "openai"),
            None,
            &request(),
            &channel,
            &mut cancel
        )
        .await
        .unwrap(),
        Outcome::Done
    ));
    let captured = captured.lock().unwrap();
    let events: Vec<serde_json::Value> = captured
        .iter()
        .filter_map(|body| match body {
            tauri::ipc::InvokeResponseBody::Json(body) => serde_json::from_str(body).ok(),
            _ => None,
        })
        .collect();
    assert_eq!(
        events
            .iter()
            .filter(|event| event["type"] == "delta")
            .count(),
        1
    );
    drop(captured);
    server.await.unwrap();
    let (base, stalled) = mock_server(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
        true,
    )
    .await;
    let canceled = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        sender.send(true).unwrap();
    });
    assert!(matches!(
        tokio::time::timeout(
            Duration::from_secs(1),
            stream_with_provider(
                &provider_at(&base, "openai"),
                None,
                &request(),
                &channel,
                &mut cancel
            )
        )
        .await
        .unwrap()
        .unwrap(),
        Outcome::Stopped
    ));
    canceled.await.unwrap();
    stalled.abort();
}

#[test]
fn ai_assistant_deletion_reclaims_exclusive_attachment_and_backup() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let mut value = workspace();
    storage::save(&root, &value).unwrap();
    assert_eq!(
        std::fs::read_dir(root.join("attachments")).unwrap().count(),
        1
    );
    value.conversations.clear();
    storage::save(&root, &value).unwrap();
    assert_eq!(
        std::fs::read_dir(root.join("attachments")).unwrap().count(),
        0
    );
    assert_eq!(
        std::fs::read_dir(root.join("conversations"))
            .unwrap()
            .count(),
        0
    );
    std::fs::write(root.join("workspace.json"), "corrupt").unwrap();
    assert!(storage::load(&root)
        .unwrap()
        .unwrap()
        .conversations
        .is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn ai_assistant_payload_omits_unset_parameters_and_blocks_partial_answers() {
    let mut value = request();
    let provider = provider_at("http://localhost:11434", "ollama");
    let body = engine::payload_for_test(&provider, &value).unwrap();
    assert!(body.get("options").is_none());
    value.messages[0].role = "assistant".into();
    value.messages[0].status = "stopped".into();
    assert!(engine::payload_for_test(&provider, &value).is_err());
}

#[test]
fn ai_assistant_future_version_is_not_silently_replaced_by_backup() {
    let root = std::env::temp_dir().join(format!("niuery-ai-test-{}", nanoid::nanoid!()));
    let value = workspace();
    storage::save(&root, &value).unwrap();
    let path = root.join("workspace.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    index["version"] = serde_json::json!(2);
    std::fs::write(&path, serde_json::to_vec(&index).unwrap()).unwrap();
    assert!(storage::load(&root).is_err());
    assert!(storage::save(&root, &value).is_err());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap()
            ["version"],
        2
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn ai_assistant_backend_rejects_disguised_binary_text_and_wrong_extension() {
    let mut attachment: Attachment = serde_json::from_value(serde_json::json!({"id":"a1","name":"binary.txt","kind":"text","mimeType":"text/plain","size":3,"data":"a\u{1}b"})).unwrap();
    assert!(validation::validate_attachments(&[attachment.clone()]).is_err());
    attachment.data = "pdf".into();
    attachment.name = "binary.pdf".into();
    assert!(validation::validate_attachments(&[attachment]).is_err());
}

#[cfg(windows)]
#[test]
fn ai_assistant_windows_credentials_are_isolated_by_app_identifier() {
    struct Cleanup(String, String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = credentials::remove_all(&self.0);
            let _ = credentials::remove_all(&self.1);
        }
    }
    let clean = Cleanup(
        format!("ai-test-{}", nanoid::nanoid!()),
        format!("ai-test-{}", nanoid::nanoid!()),
    );
    credentials::write(&clean.0, "provider1", "test-only-secret").unwrap();
    credentials::write(&clean.1, "provider1", "other-test-secret").unwrap();
    assert_eq!(
        credentials::read(&clean.0, "provider1").unwrap().as_deref(),
        Some("test-only-secret")
    );
    credentials::remove_all(&clean.0).unwrap();
    assert!(credentials::read(&clean.0, "provider1").unwrap().is_none());
    assert_eq!(
        credentials::read(&clean.1, "provider1").unwrap().as_deref(),
        Some("other-test-secret")
    );
    credentials::remove(&clean.1, "provider1").unwrap();
    assert!(credentials::read(&clean.1, "provider1").unwrap().is_none());
}

#[tokio::test]
async fn ai_assistant_cancel_waits_until_request_releases_active_slot() {
    let state = std::sync::Arc::new(AiState::default());
    let (sender, mut receiver) = watch::channel(false);
    let (completed, completion) = watch::channel(false);
    *state.active.lock().unwrap() = Some(Active {
        request_id: "r1".into(),
        cancel: sender,
        completion,
    });
    let worker_state = state.clone();
    let worker = tokio::spawn(async move {
        receiver.changed().await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        *worker_state.active.lock().unwrap() = None;
        completed.send(true).unwrap();
    });
    cancel_active_request(&state, "r1").await.unwrap();
    assert!(state.active.lock().unwrap().is_none());
    worker.await.unwrap();
}

#[tokio::test]
async fn ai_assistant_keeps_valid_tokens_before_same_chunk_error_and_incomplete_eof() {
    for response in [
        &b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"keep\"}}]}\n\ndata: {\"error\":\"failed\"}\n\n"[..],
        &b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"keep\"}}]}"[..],
    ] {
        let (base, server) = mock_server(response, false).await;
        let captured = std::sync::Arc::new(Mutex::new(Vec::new()));
        let capture = captured.clone();
        let channel = Channel::new(move |body| { capture.lock().unwrap().push(body); Ok(()) });
        let (_sender, mut cancel) = watch::channel(false);
        assert!(stream_with_provider(&provider_at(&base, "openai"), None, &request(), &channel, &mut cancel).await.is_err());
        assert_eq!(captured.lock().unwrap().len(), 1, "valid tokens were discarded before reporting a stream error");
        server.await.unwrap();
    }
}

#[test]
fn ai_assistant_exit_handshake_waits_for_save_and_preserves_restart_code() {
    let mut state = ExitState::default();
    assert!(matches!(state.prepare(Some(0)), ExitDecision::Allow));
    state.ready = true;
    assert!(matches!(state.prepare(Some(123)), ExitDecision::Prepare));
    assert!(matches!(state.prepare(Some(0)), ExitDecision::Wait));
    assert_eq!(state.complete(false), None);
    assert!(matches!(state.prepare(Some(123)), ExitDecision::Prepare));
    assert_eq!(state.complete(true), Some(ExitAction::Exit(123)));
    assert!(matches!(state.prepare(Some(123)), ExitDecision::Allow));
}

#[test]
fn ai_assistant_restart_is_deferred_before_tauri_restart_and_requires_success() {
    let mut state = ExitState::default();
    state.ready = true;
    assert!(matches!(
        state.prepare(Some(tauri::RESTART_EXIT_CODE)),
        ExitDecision::Prepare
    ));
    assert_eq!(state.complete(false), None);
    assert!(matches!(
        state.prepare(Some(tauri::RESTART_EXIT_CODE)),
        ExitDecision::Prepare
    ));
    assert_eq!(state.complete(true), Some(ExitAction::Restart));
    assert!(matches!(
        state.prepare(Some(tauri::RESTART_EXIT_CODE)),
        ExitDecision::Allow
    ));
}

#[test]
fn ai_assistant_disposing_listener_abandons_pending_exit_instead_of_hanging() {
    let mut state = ExitState::default();
    state.ready = true;
    assert!(matches!(state.prepare(Some(0)), ExitDecision::Prepare));
    assert!(state.set_ready(false));
    assert!(matches!(state.prepare(Some(0)), ExitDecision::Allow));
    assert_eq!(state.complete(true), None);
}

fn event_text(events: &[serde_json::Value], kind: &str) -> String {
    events
        .iter()
        .filter(|event| event["type"] == kind)
        .filter_map(|event| event["text"].as_str())
        .collect()
}
async fn stream_fixture(
    kind: &str,
    body: &str,
) -> (Vec<serde_json::Value>, Result<Outcome, String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/custom", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nConnection: close\r\n\r\n{}",
        if kind == "ollama" {
            "application/x-ndjson"
        } else {
            "text/event-stream"
        },
        body
    );
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut input = Vec::new();
        loop {
            let mut chunk = [0; 8192];
            let count = socket.read(&mut chunk).await.unwrap();
            if count == 0 {
                break;
            }
            input.extend_from_slice(&chunk[..count]);
            if let Some(end) = input.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&input[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if input.len() >= end + 4 + length {
                    break;
                }
            }
        }
        // Emit each byte separately to exercise split multibyte UTF-8 and framing.
        for byte in response.as_bytes() {
            if socket.write_all(&[*byte]).await.is_err() {
                break;
            }
            tokio::task::yield_now().await;
        }
    });
    let events = std::sync::Arc::new(Mutex::new(Vec::new()));
    let shared = events.clone();
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            shared
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(&body).unwrap());
        }
        Ok(())
    });
    let (_sender, mut cancel) = watch::channel(false);
    let result = stream_with_provider(
        &provider_at(&base, kind),
        None,
        &request(),
        &channel,
        &mut cancel,
    )
    .await;
    server.await.unwrap();
    let collected = events.lock().unwrap().clone();
    (collected, result)
}
