use super::*;

#[test]
fn ai_assistant_streams_split_utf8_and_multiline_sse() {
    let mut decoder = protocol::Decoder::new("openai");
    let stream =
        "data: {\"choices\":\ndata: [{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\n\n";
    let mut deltas = Vec::new();
    for byte in stream.as_bytes() {
        deltas.extend(decoder.push(&[*byte]).unwrap());
    }
    assert_eq!(deltas, vec!["你好"]);
    assert!(decoder.finish().is_ok());
}

#[test]
fn ai_assistant_ollama_requires_terminal_marker() {
    let mut decoder = protocol::Decoder::new("ollama");
    assert_eq!(
        decoder
            .push(b"{\"message\":{\"content\":\"ok\"},\"done\":false}\n")
            .unwrap(),
        vec!["ok"]
    );
    assert!(decoder.finish().is_err());
    assert!(decoder.push(b"{\"done\":true}\n").unwrap().is_empty());
    assert!(decoder.finish().is_ok());
}

#[test]
fn ai_assistant_urls_preserve_configured_prefix_and_reject_secrets() {
    assert_eq!(
        protocol::endpoint("https://example.com/custom/v1/", "chat/completions")
            .unwrap()
            .as_str(),
        "https://example.com/custom/v1/chat/completions"
    );
    assert!(protocol::endpoint("https://user:pass@example.com/v1", "models").is_err());
    assert!(protocol::endpoint("file:///tmp/key", "models").is_err());
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

fn provider_at(base: &str, kind: &str) -> Provider {
    serde_json::from_value(serde_json::json!({"id":"p1","name":"Mock","kind":kind,"baseUrl":base,"hasApiKey":false,"models":[{"id":"model","name":"Model","supportsImages":false}],"enabled":true})).unwrap()
}

fn request() -> Request {
    serde_json::from_value(serde_json::json!({"requestId":"r1","conversationId":"chat1","messageId":"reply1","providerId":"p1","modelId":"model","systemPrompt":"system","parameters":{"historyRounds":20},"messages":[{"id":"m1","role":"user","content":"question","attachments":[],"createdAt":1,"status":"complete"}]})).unwrap()
}

async fn mock_server(
    response: &'static [u8],
    hold: bool,
) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 65536];
        let count = stream.read(&mut request).await.unwrap();
        request.truncate(count);
        stream.write_all(response).await.unwrap();
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
    assert_eq!(captured.lock().unwrap().len(), 1);
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
    let body = protocol::payload(&value, &provider).unwrap();
    assert!(body.get("options").is_none());
    value.messages[0].role = "assistant".into();
    value.messages[0].status = "stopped".into();
    assert!(protocol::payload(&value, &provider).is_err());
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
    assert!(protocol::validate_attachments(&[attachment.clone()]).is_err());
    attachment.data = "pdf".into();
    attachment.name = "binary.pdf".into();
    assert!(protocol::validate_attachments(&[attachment]).is_err());
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
