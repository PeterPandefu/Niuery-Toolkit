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
    pub fn new() -> std::result::Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "无法初始化模型客户端")?;
        Ok(Self {
            inner: ReqwestClient::from(client.clone()),
            client,
            fault: Fault::default(),
            first_byte_timeout: Duration::from_secs(60),
            idle_timeout: Duration::from_secs(120),
        })
    }
    pub fn fault(&self) -> Fault {
        self.fault.clone()
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
