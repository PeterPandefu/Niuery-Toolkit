use super::*;

#[test]
fn ai_assistant_rig_uses_native_ollama_without_splitting_content_think_tags() {
    use rig_core::{message::AssistantContent, wire::WireFrame};
    let provider = super::super::tests::provider_at("http://localhost", "ollama");
    let input = super::super::tests::request();
    let request = request::convert(&input, &provider).unwrap();
    let response = wires::decode_ollama_for_test(&provider, request, vec![WireFrame::Text("{\"message\":{\"content\":\"<think>literal</think>Answer\",\"thinking\":\"Separate thought\"},\"done\":true,\"done_reason\":\"stop\"}".into())]);
    let response = response.unwrap();
    let text = response
        .choice
        .iter()
        .filter_map(|part| {
            if let AssistantContent::Text(text) = part {
                Some(text.text.clone())
            } else {
                None
            }
        })
        .collect::<String>();
    assert_eq!(text, "<think>literal</think>Answer");
}

#[tokio::test]
async fn ai_assistant_rig_http_normalizes_thinking_and_text_without_repeating_end_parts() {
    let (base, server) = super::super::tests::mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Thought\",\"content\":\"Answer\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: [DONE]\n\n", false).await;
    let mut provider = super::super::tests::provider_at(&base, "openai");
    provider.models[0].stream_usage = Some(true);
    let capture = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let shared = capture.clone();
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
    assert!(matches!(
        generate(
            &provider,
            None,
            &super::super::tests::request(),
            &channel,
            &mut cancel
        )
        .await
        .unwrap(),
        Outcome::Done
    ));
    let body = String::from_utf8(server.await.unwrap()).unwrap();
    assert!(!body.to_lowercase().contains("authorization:"));
    let events = capture.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event["type"] == "delta")
            .map(|event| event["text"].as_str().unwrap())
            .collect::<String>(),
        "Answer"
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event["type"] == "thinking")
            .map(|event| event["text"].as_str().unwrap())
            .collect::<String>(),
        "Thought"
    );
    assert_eq!(events.last().unwrap()["usage"]["totalTokens"], 30);
}
#[tokio::test]
async fn ai_assistant_rig_native_request_preserves_prefix_parameters_and_no_auth() {
    let (base, server) = super::super::tests::mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n{\"message\":{\"content\":\"<think>literal</think>Answer\",\"thinking\":\"Separate\"},\"done\":true}\n", false).await;
    let mut provider = super::super::tests::provider_at(&base, "ollama");
    let mut input = super::super::tests::request();
    input.parameters.max_output_tokens = Some(24);
    input.parameters.temperature = Some(0.5);
    provider.models[0].max_output_tokens = Some(12);
    let capture = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let shared = capture.clone();
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
    assert!(generate(&provider, None, &input, &channel, &mut cancel)
        .await
        .is_ok());
    let sent = String::from_utf8(server.await.unwrap()).unwrap();
    assert!(sent.starts_with("POST /v1/api/chat "));
    assert!(!sent.to_lowercase().contains("authorization:"));
    let payload: serde_json::Value =
        serde_json::from_str(sent.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(payload["options"]["num_predict"], 12);
    assert_eq!(payload["options"]["temperature"], 0.5);
    let events = capture.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event["type"] == "delta")
            .map(|event| event["text"].as_str().unwrap())
            .collect::<String>(),
        "<think>literal</think>Answer"
    );
}

#[tokio::test]
async fn ai_assistant_rig_redirect_and_failure_do_not_resend_or_expose_keys() {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    for status in [302, 429, 500] {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/custom", source.local_addr().unwrap());
        let response = format!("HTTP/1.1 {status} Failed\r\nLocation: http://{}/steal\r\nContent-Length: 100000000\r\n\r\necho-secret", target.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = source.accept().await.unwrap();
            let mut input = [0; 16384];
            let count = socket.read(&mut input).await.unwrap();
            socket.write_all(response.as_bytes()).await.unwrap();
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(80), source.accept())
                    .await
                    .is_err(),
                "automatic retry"
            );
            String::from_utf8_lossy(&input[..count]).into_owned()
        });
        let (_sender, mut cancel) = watch::channel(false);
        let channel = Channel::new(|_| Ok(()));
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            generate(
                &super::super::tests::provider_at(&base, "openai"),
                Some("echo-secret"),
                &super::super::tests::request(),
                &channel,
                &mut cancel,
            ),
        )
        .await
        .unwrap();
        let error = result.err().unwrap();
        assert!(error.contains(&status.to_string()));
        assert!(!error.contains("echo-secret"));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), target.accept())
                .await
                .is_err(),
            "redirect followed"
        );
        assert!(server
            .await
            .unwrap()
            .to_lowercase()
            .contains("authorization: bearer echo-secret"));
    }
}

#[test]
fn ai_assistant_rig_encodes_images_text_and_explicit_model_options() {
    use base64::Engine;
    let mut data = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut data, image::ImageFormat::Png)
        .unwrap();
    let image = data.into_inner();
    let mut input = super::super::tests::request();
    input.messages[0].attachments=vec![serde_json::from_value(serde_json::json!({"id":"png","name":"a.png","kind":"image","mimeType":"image/png","size":image.len(),"data":base64::engine::general_purpose::STANDARD.encode(&image)})).unwrap(),serde_json::from_value(serde_json::json!({"id":"txt","name":"a.txt","kind":"text","mimeType":"text/plain","size":4,"data":"file"})).unwrap()];
    input.parameters.max_output_tokens = Some(40);
    input.parameters.temperature = Some(0.5);
    for kind in ["openai", "ollama"] {
        let mut provider = super::super::tests::provider_at("http://localhost/custom", kind);
        provider.models[0].supports_images = true;
        provider.models[0].supports_temperature = Some(true);
        provider.models[0].stream_usage = Some(false);
        let body = wires::payload_for_test(&provider, &input).unwrap();
        assert!(body.to_string().contains("attached_file"));
        assert!(body
            .to_string()
            .contains(&base64::engine::general_purpose::STANDARD.encode(&image)));
        assert!(body.get("stream_options").is_none());
        if kind == "ollama" {
            assert_eq!(body["options"]["num_predict"], 40);
        } else {
            assert_eq!(body["max_tokens"], 40);
        }
    }
}
#[tokio::test]
async fn ai_assistant_rig_text_only_wire_uses_strings() {
    let provider = super::super::tests::provider_at("http://localhost/custom", "openai");
    let body = wires::payload_for_test(&provider, &super::super::tests::request()).unwrap();
    assert!(body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|message| message["content"].is_string()));
}

#[tokio::test]
async fn ai_assistant_rig_preserves_received_metadata_before_failure() {
    let (base, server)=super::super::tests::mock_server(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: {\"error\":\"failure\"}\n\n",false).await;
    let capture = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let shared = capture.clone();
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
    assert!(generate(
        &super::super::tests::provider_at(&base, "openai"),
        None,
        &super::super::tests::request(),
        &channel,
        &mut cancel
    )
    .await
    .is_err());
    server.await.unwrap();
    let events = capture.lock().unwrap();
    assert!(events
        .iter()
        .any(|event| event["usage"]["totalTokens"] == 30));
}
#[tokio::test]
async fn ai_assistant_rig_preserves_nonstandard_and_filtered_finish_reasons() {
    for kind in ["openai", "ollama"] {
        for reason in ["length", "content_filter", "custom_stop"] {
            let body = if kind == "ollama" {
                serde_json::json!({"message":{"content":"kept"},"done":true,"done_reason":reason})
                    .to_string()
                    + "\n"
            } else {
                format!(
                    "data: {}\n\ndata: [DONE]\n\n",
                    serde_json::json!({"choices":[{"delta":{"content":"kept"},"finish_reason":reason}]})
                )
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nConnection: close\r\n\r\n{}",
                if kind == "ollama" {
                    "application/x-ndjson"
                } else {
                    "text/event-stream"
                },
                body
            );
            let (base, server) = super::super::tests::mock_server(response.as_bytes(), false).await;
            let (_sender, mut cancel) = watch::channel(false);
            let channel = Channel::new(|_| Ok(()));
            let result = generate(
                &super::super::tests::provider_at(&base, kind),
                None,
                &super::super::tests::request(),
                &channel,
                &mut cancel,
            )
            .await;
            assert!(
                matches!(result, Ok(Outcome::Done)),
                "{kind} {reason}: {:?}",
                result.err()
            );
            server.await.unwrap();
        }
    }
}
#[test]
fn ai_assistant_rig_explicit_capabilities_override_model_name_heuristics() {
    let mut provider = super::super::tests::provider_at("http://localhost", "openai");
    provider.models[0].id = "o3".into();
    provider.models[0].supports_temperature = Some(true);
    provider.models[0].output_token_parameter = Some("max_tokens".into());
    let mut input = super::super::tests::request();
    input.model_id = "o3".into();
    input.parameters.temperature = Some(0.7);
    input.parameters.max_output_tokens = Some(200);
    let body = wires::payload_for_test(&provider, &input).unwrap();
    assert_eq!(body["temperature"], 0.7);
    assert_eq!(body["max_tokens"], 200);
    assert!(body.get("max_completion_tokens").is_none());
}
