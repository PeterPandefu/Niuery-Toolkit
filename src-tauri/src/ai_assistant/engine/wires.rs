use super::{super::types::Provider, transport::GuardedHttp};
use rig_core::{
    completion::{CompletionRequest, FinishReason, Usage},
    driver::Model,
    error::{EncodeError, ProviderError},
    operation::{Block, Completion, Finish},
    providers::{
        ollama::{streaming::ChatRecord, Chat as OllamaChat, OllamaConfig},
        openai::{
            wire::{Auth, Chat as OpenAiChat, Dialect, Quirks},
            OpenAIConfig,
        },
    },
    streaming::CompletionStream,
    wire::{Body, Decoder, Descriptor, Encoded, Flow, Mode, Out, Wire, WireEvent, WireFrame},
};
use serde_json::Value;

#[derive(Clone, Default)]
pub(super) struct ObservedMetadata(
    std::sync::Arc<std::sync::Mutex<(Option<String>, Option<super::super::types::Usage>)>>,
);
impl ObservedMetadata {
    fn observe(&self, bytes: &[u8], native: bool) {
        // Deserialize only metadata. Large text fields are skipped without cloning them.
        #[derive(serde::Deserialize)]
        struct Choice {
            finish_reason: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct Counts {
            prompt_tokens: Option<u64>,
            completion_tokens: Option<u64>,
            total_tokens: Option<u64>,
        }
        #[derive(serde::Deserialize)]
        struct Frame {
            choices: Option<Vec<Choice>>,
            usage: Option<Counts>,
            done_reason: Option<String>,
            prompt_eval_count: Option<u64>,
            eval_count: Option<u64>,
        }
        let Ok(frame) = serde_json::from_slice::<Frame>(bytes) else {
            return;
        };
        let reason = if native {
            frame.done_reason
        } else {
            frame
                .choices
                .and_then(|choices| choices.into_iter().next())
                .and_then(|choice| choice.finish_reason)
        };
        let counts = if native {
            frame
                .prompt_eval_count
                .zip(frame.eval_count)
                .map(|(input, output)| (input, output, input.saturating_add(output)))
        } else {
            frame.usage.and_then(|usage| {
                usage
                    .prompt_tokens
                    .zip(usage.completion_tokens)
                    .map(|(input, output)| {
                        (
                            input,
                            output,
                            usage.total_tokens.unwrap_or(input.saturating_add(output)),
                        )
                    })
            })
        };
        let mut current = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(reason) = reason {
            current.0 = Some(reason.chars().take(64).collect());
        }
        if let Some((input_tokens, output_tokens, total_tokens)) = counts {
            current.1 = Some(super::super::types::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
            });
        }
    }
    pub fn apply(&self, event: &mut super::super::types::StreamEvent) {
        let current = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if current.0.is_some() {
            event.finish_reason = current.0.clone();
        }
        if current.1.is_some() {
            event.usage = current.1.clone();
        }
    }
}

static COMPAT: Dialect = Dialect::gateway("niuery-compatible", "http://localhost", "UNUSED")
    .with_quirks(
        Quirks::openai()
            .done_without_finish_reason()
            .without_stream_usage(),
    );

#[derive(Clone)]
struct CompatibleChat {
    observed: ObservedMetadata,
    inner: OpenAiChat,
    output_parameter: String,
    stream_usage: bool,
}
impl Wire for CompatibleChat {
    type Op = Completion;
    type Payload = Encoded;
    type Frame = WireFrame;
    type Event = <OpenAiChat as Wire>::Event;
    type Decoder<'id> = CompatDecoder<<OpenAiChat as Wire>::Decoder<'id>>;
    type Reassembler = <OpenAiChat as Wire>::Reassembler;
    fn describe(&self) -> Descriptor<'_> {
        self.inner.describe()
    }
    fn encode(&self, mut request: CompletionRequest, mode: Mode) -> Result<Encoded, EncodeError> {
        let cap = request.max_tokens;
        let temperature = request.temperature.take();
        let mut result = self.inner.encode(request, mode)?;
        if let Body::Bytes(bytes) = &mut result.request.body_mut() {
            let mut body: Value = serde_json::from_slice(bytes)
                .map_err(|_| EncodeError::request("模型请求编码失败"))?;
            let object = body
                .as_object_mut()
                .ok_or_else(|| EncodeError::request("模型请求编码失败"))?;
            object.remove("max_tokens");
            object.remove("max_completion_tokens");
            object.remove("temperature");
            if let Some(temperature) = temperature {
                object.insert("temperature".into(), temperature.into());
            }
            if let Some(cap) = cap {
                object.insert(self.output_parameter.clone(), cap.into());
            }
            object.remove("stream_options");
            if self.stream_usage && matches!(mode, Mode::Streaming) {
                object.insert(
                    "stream_options".into(),
                    serde_json::json!({"include_usage":true}),
                );
            }
            if let Some(messages) = object.get_mut("messages").and_then(Value::as_array_mut) {
                for message in messages {
                    if let Some(message) = message.as_object_mut() {
                        for key in [
                            "reasoning",
                            "reasoning_content",
                            "reasoning_text",
                            "thinking",
                        ] {
                            message.remove(key);
                        }
                        // Preserve string content for text-only compatible endpoints.
                        if let Some(parts) = message.get("content").and_then(Value::as_array) {
                            if parts
                                .iter()
                                .all(|part| part["type"] == "text" && part["text"].is_string())
                            {
                                let text: String = parts
                                    .iter()
                                    .filter_map(|part| part["text"].as_str())
                                    .collect();
                                message.insert("content".into(), Value::String(text));
                            }
                        }
                    }
                }
            }
            *bytes =
                serde_json::to_vec(&body).map_err(|_| EncodeError::request("模型请求编码失败"))?;
        }
        Ok(result)
    }
    fn decoder<'id>(&self) -> Self::Decoder<'id> {
        CompatDecoder {
            inner: self.inner.decoder(),
            observed: self.observed.clone(),
            seen: false,
            empty_done: std::cell::Cell::new(false),
        }
    }
}

struct CompatDecoder<D> {
    observed: ObservedMetadata,
    inner: D,
    seen: bool,
    empty_done: std::cell::Cell<bool>,
}
impl<'id, D: Decoder<'id, Completion>> Decoder<'id, Completion> for CompatDecoder<D> {
    type Event = D::Event;
    fn classify(&self, frame: WireFrame) -> WireEvent<D::Event> {
        self.observed.observe(frame.as_bytes(), false);
        self.empty_done
            .set(!self.seen && frame.as_bytes() == b"[DONE]");
        self.inner.classify(frame)
    }
    fn decode(
        &mut self,
        event: D::Event,
        out: Out<'id, Completion>,
    ) -> Result<Flow, ProviderError> {
        if self.empty_done.replace(false) {
            return Ok(out.end(Finish::default()));
        }
        self.seen = true;
        self.inner.decode(event, out)
    }
    fn eof(&mut self, out: Out<'id, Completion>) -> Result<Flow, ProviderError> {
        self.inner.eof(out)
    }
}

#[derive(Clone)]
struct NativeChat(OllamaChat, ObservedMetadata);
impl Wire for NativeChat {
    type Op = Completion;
    type Payload = Encoded;
    type Frame = WireFrame;
    type Event = ChatRecord;
    type Decoder<'id> = StrictOllamaDecoder;
    type Reassembler = <OllamaChat as Wire>::Reassembler;
    fn describe(&self) -> Descriptor<'_> {
        self.0.describe()
    }
    fn encode(&self, request: CompletionRequest, mode: Mode) -> Result<Encoded, EncodeError> {
        self.0.encode(request, mode)
    }
    fn decoder<'id>(&self) -> Self::Decoder<'id> {
        StrictOllamaDecoder(self.1.clone())
    }
}

pub struct StrictOllamaDecoder(ObservedMetadata);
impl<'id> Decoder<'id, Completion> for StrictOllamaDecoder {
    type Event = ChatRecord;
    fn classify(&self, frame: WireFrame) -> WireEvent<ChatRecord> {
        self.0.observe(frame.as_bytes(), true);
        match serde_json::from_slice::<Value>(frame.as_bytes()) {
            Ok(Value::Object(value)) => WireEvent::Known(ChatRecord(value)),
            Ok(value) => WireEvent::Unknown {
                event_type: "unknown".into(),
                value: rig_core::streaming::UnknownPayload::new(value),
            },
            Err(error) => WireEvent::Corrupt(error),
        }
    }
    fn decode(
        &mut self,
        ChatRecord(fields): ChatRecord,
        mut out: Out<'id, Completion>,
    ) -> Result<Flow, ProviderError> {
        let value = Value::Object(fields);
        if value.get("error").is_some_and(|error| !error.is_null()) {
            return Err(ProviderError::from_provider_body(value.to_string()));
        }
        if let Some(text) = value
            .pointer("/message/thinking")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            out.run(Block::Reasoning { redacted: false }, text)?;
        }
        if let Some(text) = value
            .pointer("/message/content")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            out.run(Block::Text, text)?;
        }
        if value.get("done").and_then(Value::as_bool) != Some(true) {
            return Ok(Flow::More);
        }
        out.end_run()?;
        out.finish_open()?;
        let reason = value
            .get("done_reason")
            .and_then(Value::as_str)
            .map(|value| match value {
                "stop" => FinishReason::Stop,
                "length" => FinishReason::Length,
                other => FinishReason::Other(other.into()),
            });
        let (input_tokens, output_tokens) = (
            value.get("prompt_eval_count").and_then(Value::as_u64),
            value.get("eval_count").and_then(Value::as_u64),
        );
        let mut usage = Usage::default();
        usage.input_tokens = input_tokens;
        usage.output_tokens = output_tokens;
        usage.total_tokens = input_tokens
            .zip(output_tokens)
            .map(|(input, output)| input.saturating_add(output));
        Ok(out.end(Finish {
            reason,
            usage,
            ..Finish::default()
        }))
    }
}

pub fn open(
    provider: &Provider,
    key: Option<&str>,
    model: &str,
    request: CompletionRequest,
    http: GuardedHttp,
    observed: ObservedMetadata,
) -> Result<CompletionStream, ProviderError> {
    if provider.kind == "ollama" {
        let config = OllamaConfig::new()
            .with_base_url(&provider.base_url)
            .with_api_key(key.unwrap_or_default());
        let native = config.connect(http.clone()).native_completion(model);
        Model::new(NativeChat(native.wire, observed.clone()), http).stream(request)
    } else {
        let selected = provider
            .models
            .iter()
            .find(|item| item.id == model)
            .ok_or_else(|| ProviderError::request("模型已停用"))?;
        let chat = OpenAIConfig::with_key(&COMPAT, key.unwrap_or_default())
            .with_auth(Auth::OptionalBearer)
            .with_base_url(&provider.base_url)
            .chat(model);
        Model::new(
            CompatibleChat {
                observed,
                inner: chat,
                output_parameter: selected
                    .output_token_parameter
                    .clone()
                    .unwrap_or_else(|| "max_tokens".into()),
                stream_usage: selected.stream_usage == Some(true),
            },
            http,
        )
        .stream(request)
    }
}

#[cfg(test)]
pub(super) fn decode_ollama_for_test(
    provider: &Provider,
    request: CompletionRequest,
    frames: Vec<WireFrame>,
) -> Result<rig_core::completion::CompletionResponse, ProviderError> {
    let native = OllamaConfig::new()
        .with_base_url(&provider.base_url)
        .connect(GuardedHttp::new().unwrap())
        .native_completion("model");
    rig_core::wire::decode_reply(
        &NativeChat(native.wire, ObservedMetadata::default()),
        &request,
        Mode::Streaming,
        frames,
    )
}

#[cfg(test)]
pub(crate) fn payload_for_test(
    provider: &Provider,
    input: &super::super::types::Request,
) -> Result<Value, String> {
    let request = super::request::convert(input, provider)?;
    let encoded = if provider.kind == "ollama" {
        let native = OllamaConfig::new()
            .with_base_url(&provider.base_url)
            .connect(GuardedHttp::new()?)
            .native_completion(&input.model_id);
        NativeChat(native.wire, ObservedMetadata::default()).encode(request, Mode::Streaming)
    } else {
        let selected = provider
            .models
            .iter()
            .find(|model| model.id == input.model_id)
            .ok_or("请选择模型")?;
        let chat = OpenAIConfig::with_key(&COMPAT, "")
            .with_auth(Auth::OptionalBearer)
            .with_base_url(&provider.base_url)
            .chat(&input.model_id);
        CompatibleChat {
            observed: ObservedMetadata::default(),
            inner: chat,
            output_parameter: selected
                .output_token_parameter
                .clone()
                .unwrap_or_else(|| "max_tokens".into()),
            stream_usage: selected.stream_usage == Some(true),
        }
        .encode(request, Mode::Streaming)
    }
    .map_err(|_| "请求编码失败")?;
    match encoded.request.into_body() {
        Body::Bytes(bytes) => serde_json::from_slice(&bytes).map_err(|_| "请求编码失败".into()),
        _ => Err("请求编码失败".into()),
    }
}
