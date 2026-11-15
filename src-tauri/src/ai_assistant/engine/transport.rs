use futures_util::{stream, StreamExt};
use rig_core::http_client::{
    Bytes, Error, HttpClientExt, LazyBody, MultipartForm, Request, Response, Result,
    StreamingResponse,
};
use rig_reqwest::{reqwest, ReqwestClient};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::{timeout_at, Instant};

const MAX_EVENT: usize = 16 * 1024 * 1024;
#[derive(Clone, Default)]
pub struct Fault(Arc<Mutex<Option<String>>>);
impl Fault {
    fn fail(&self, message: &str) -> Error {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(message.to_owned());
        Error::instance(std::io::Error::other(message.to_owned()))
    }
    pub fn message(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

#[derive(Clone)]
pub struct GuardedHttp {
    inner: ReqwestClient,
    client: reqwest::Client,
    fault: Fault,
    first_byte_timeout: Duration,
    idle_timeout: Duration,
}
impl GuardedHttp {
    fn builder() -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(60))
    }

    fn from_builder(
        builder: reqwest::ClientBuilder,
        failure: &str,
    ) -> std::result::Result<Self, String> {
        let client = builder.build().map_err(|_| failure.to_string())?;
        Ok(Self {
            inner: ReqwestClient::from(client.clone()),
            client,
            fault: Fault::default(),
            first_byte_timeout: Duration::from_secs(60),
            idle_timeout: Duration::from_secs(120),
        })
    }

    pub fn new() -> std::result::Result<Self, String> {
        Self::from_builder(Self::builder(), "无法初始化模型客户端")
    }

    /// reqwest inherits system and environment proxies by default, which could
    /// silently route a tool URL through a proxy. Tools must reach exactly the
    /// host they were given, so proxy discovery is disabled here.
    pub fn for_tools() -> std::result::Result<Self, String> {
        Self::from_builder(Self::builder().no_proxy(), "无法初始化工具网络客户端")
    }

    pub fn fault(&self) -> Fault {
        self.fault.clone()
    }
}

/// Tool-layer GET outcome. Deliberately separate from the model stream's Fault
/// so a tool failure never surfaces model-specific wording or writes its state.
pub struct CappedResponse {
    pub status: u16,
    pub location: Option<String>,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub enum ToolHttpError {
    InvalidUrl,
    Timeout,
    TooLarge,
    Network,
}

impl ToolHttpError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidUrl => "工具 URL 无效，仅支持不含凭据的 HTTP/HTTPS 地址。",
            Self::Timeout => "工具请求超时，已停止等待。",
            Self::TooLarge => "工具响应过大，已停止读取。",
            Self::Network => "工具请求失败，请检查网络或目标地址。",
        }
    }
}

impl GuardedHttp {
    /// The URL is passed through verbatim: no prefixing, no mirror fallback, no
    /// alternate-host retry. Redirects are never followed, so a genuine address
    /// cannot be silently bounced to a proxy; the caller reports the Location
    /// and any new address must come back as a fresh, separately approved call.
    pub async fn get_capped(
        &self,
        url: &str,
        max_bytes: usize,
    ) -> std::result::Result<CappedResponse, ToolHttpError> {
        self.send_capped(reqwest::Method::GET, url, None, None, max_bytes)
            .await
    }

    /// The endpoint comes from the user's own configured base URL plus a fixed
    /// suffix; the bearer key never leaves Rust.
    pub async fn post_json_capped(
        &self,
        url: &str,
        body: &serde_json::Value,
        bearer: Option<&str>,
        max_bytes: usize,
    ) -> std::result::Result<CappedResponse, ToolHttpError> {
        self.send_capped(reqwest::Method::POST, url, Some(body), bearer, max_bytes)
            .await
    }

    async fn send_capped(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&serde_json::Value>,
        bearer: Option<&str>,
        max_bytes: usize,
    ) -> std::result::Result<CappedResponse, ToolHttpError> {
        let parsed = reqwest::Url::parse(url).map_err(|_| ToolHttpError::InvalidUrl)?;
        let mut request = self.client.request(method, parsed);
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(key) = bearer {
            request = request.bearer_auth(key);
        }
        let deadline = Instant::now() + self.first_byte_timeout;
        let response = timeout_at(deadline, request.send())
            .await
            .map_err(|_| ToolHttpError::Timeout)?
            .map_err(|_| ToolHttpError::Network)?;
        let status = response.status().as_u16();
        let header = |name: reqwest::header::HeaderName| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.chars().take(2048).collect::<String>())
        };
        let location = header(reqwest::header::LOCATION);
        let content_type = header(reqwest::header::CONTENT_TYPE);
        let mut expires = Instant::now() + self.idle_timeout;
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        loop {
            let chunk = timeout_at(expires, stream.next())
                .await
                .map_err(|_| ToolHttpError::Timeout)?;
            let Some(chunk) = chunk else { break };
            let bytes = chunk.map_err(|_| ToolHttpError::Network)?;
            if bytes.is_empty() {
                continue;
            }
            if body.len() + bytes.len() > max_bytes {
                return Err(ToolHttpError::TooLarge);
            }
            body.extend_from_slice(&bytes);
            expires = Instant::now() + self.idle_timeout;
        }
        Ok(CappedResponse {
            status,
            location,
            content_type,
            body,
        })
    }
}

struct EventLimit {
    line: usize,
    event: usize,
    previous_cr: bool,
    sse: bool,
}
impl EventLimit {
    fn inspect(&mut self, bytes: &[u8]) -> bool {
        for &byte in bytes {
            if self.sse && self.previous_cr && byte == b'\n' {
                self.previous_cr = false;
                continue;
            }
            if byte == b'\n' || (self.sse && byte == b'\r') {
                if self.sse {
                    if self.line == 0 {
                        self.event = 0;
                    } else {
                        self.event = self.event.saturating_add(self.line);
                    }
                }
                self.line = 0;
                self.previous_cr = byte == b'\r';
            } else {
                self.line += 1;
                self.previous_cr = false;
            }
            if self.line > MAX_EVENT || self.event.saturating_add(self.line) > MAX_EVENT {
                return false;
            }
        }
        true
    }
    fn pending(&self) -> bool {
        self.line > 0 || self.event > 0
    }
}

impl HttpClientExt for GuardedHttp {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        self.inner.send(request)
    }
    fn send_multipart<U>(
        &self,
        request: Request<MultipartForm>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        self.inner.send_multipart(request)
    }
    fn send_streaming<T>(
        &self,
        request: Request<T>,
    ) -> impl std::future::Future<Output = Result<StreamingResponse>> + Send
    where
        T: Into<Bytes> + Send,
    {
        let client = self.client.clone();
        let fault = self.fault.clone();
        let first_byte_timeout = self.first_byte_timeout;
        let idle_timeout = self.idle_timeout;
        let sse = request.uri().path().ends_with("chat/completions");
        async move {
            let deadline = Instant::now() + first_byte_timeout;
            let (parts, body) = request.into_parts();
            let response = timeout_at(
                deadline,
                client
                    .request(parts.method, parts.uri.to_string())
                    .headers(parts.headers)
                    .body(body.into())
                    .send(),
            )
            .await
            .map_err(|_| fault.fail("等待模型首字节超时（60 秒）"))?
            .map_err(Error::instance)?;
            let status = response.status();
            let headers = response.headers().clone();
            // Generation never consumes an error body, which may be unbounded or contain echoed keys.
            if !status.is_success() {
                return Err(Error::non_success_with_details(
                    status,
                    headers,
                    String::new(),
                ));
            }
            let version = response.version();
            let body = Box::pin(response.bytes_stream());
            let guarded = stream::unfold(
                (
                    body,
                    deadline,
                    EventLimit {
                        line: 0,
                        event: 0,
                        previous_cr: false,
                        sse,
                    },
                    false,
                    false,
                    fault,
                ),
                move |(mut body, mut expires, mut limit, terminal, mut seen, fault)| async move {
                    if terminal {
                        return None;
                    }
                    match timeout_at(expires, body.next()).await {
                        Ok(Some(Ok(bytes))) => {
                            // Empty chunks do not count as byte activity.
                            if !bytes.is_empty() {
                                seen = true;
                                expires = Instant::now() + idle_timeout;
                            }
                            let result = if limit.inspect(&bytes) {
                                Ok(bytes)
                            } else {
                                Err(fault.fail("模型返回的单条流事件过大"))
                            };
                            let terminal = result.is_err();
                            Some((result, (body, expires, limit, terminal, seen, fault)))
                        }
                        Ok(Some(Err(error))) => Some((
                            Err(Error::instance(error)),
                            (body, expires, limit, true, seen, fault),
                        )),
                        // Existing compatible endpoints may omit the last SSE blank line. Let Rig decode
                        // this final frame; its decoder still rejects a missing completion marker.
                        Ok(None) if limit.sse && limit.pending() => Some((
                            Ok(Bytes::from_static(b"\n\n")),
                            (body, expires, limit, true, seen, fault),
                        )),
                        Ok(None) => None,
                        Err(_) => {
                            let message = if seen {
                                "模型输出空闲超时（120 秒），已接收内容已保留"
                            } else {
                                "等待模型首字节超时（60 秒）"
                            };
                            Some((
                                Err(fault.fail(message)),
                                (body, expires, limit, true, seen, fault),
                            ))
                        }
                    }
                },
            );
            let mut result = Response::builder()
                .status(status)
                .version(version)
                .body(Box::pin(guarded) as rig_core::http_client::BoxedStream)?;
            *result.headers_mut() = headers;
            Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ai_assistant_rig_event_limit_tracks_events_across_chunks_and_crlf() {
        for newline in ["\n", "\r\n", "\r"] {
            let mut limit = EventLimit {
                line: 0,
                event: 0,
                previous_cr: false,
                sse: true,
            };
            let line = vec![b'x'; MAX_EVENT / 2];
            assert!(limit.inspect(&line));
            assert!(limit.inspect(newline.as_bytes()));
            assert!(limit.inspect(&line));
            assert!(limit.inspect(newline.as_bytes()));
            assert!(!limit.inspect(b"x"));
            let mut limit = EventLimit {
                line: 0,
                event: 0,
                previous_cr: false,
                sse: true,
            };
            assert!(limit.inspect(&line));
            assert!(limit.inspect(format!("{newline}{newline}").as_bytes()));
            assert!(limit.inspect(&line));
        }
    }
    #[tokio::test]
    async fn ai_assistant_rig_byte_deadlines_include_heartbeat_activity() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for mode in ["first", "idle", "heartbeat"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 8192];
                socket.read(&mut request).await.unwrap();
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap();
                if mode == "first" {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    return;
                }
                socket.write_all(b": heartbeat\n\n").await.unwrap();
                if mode == "idle" {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    return;
                }
                for _ in 0..10 {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    socket.write_all(b": heartbeat\n\n").await.unwrap();
                }
                socket.write_all(b"data: [DONE]\n\n").await.unwrap();
            });
            let mut http = GuardedHttp::new().unwrap();
            http.first_byte_timeout = Duration::from_secs(2);
            http.idle_timeout = Duration::from_secs(1);
            let response = http
                .send_streaming(Request::post(url).body(Bytes::new()).unwrap())
                .await
                .unwrap();
            let mut body = response.into_body();
            let mut failed = false;
            while let Some(chunk) = body.next().await {
                if chunk.is_err() {
                    failed = true;
                    break;
                }
            }
            assert_eq!(failed, mode != "heartbeat");
            if mode == "first" {
                assert!(http.fault.message().unwrap().contains("首字节"));
            }
            if mode == "idle" {
                assert!(http.fault.message().unwrap().contains("空闲"));
            }
            server.abort();
        }
    }
}
