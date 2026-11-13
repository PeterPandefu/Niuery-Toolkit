use super::super::types::{StreamEvent, ToolDecision};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::ipc::Channel;
use tokio::sync::{oneshot, watch};

pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug)]
pub enum ApprovalError {
    Stopped,
    Unavailable,
}

struct Pending {
    request_id: String,
    tx: oneshot::Sender<ToolDecision>,
}

struct QuestionPending {
    request_id: String,
    tx: oneshot::Sender<String>,
}

/// Sequential approval plus the single active-request slot mean this map holds
/// at most one entry. Every exit path removes it, so a stale answer can never
/// unblock a later call.
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, Pending>>,
    questions: Mutex<HashMap<String, QuestionPending>>,
}

impl ApprovalRegistry {
    pub async fn request(
        &self,
        request_id: &str,
        call_id: &str,
        event: StreamEvent,
        channel: &Channel<StreamEvent>,
        cancel: &mut watch::Receiver<bool>,
        timeout: Duration,
    ) -> Result<ToolDecision, ApprovalError> {
        if *cancel.borrow() {
            return Err(ApprovalError::Stopped);
        }
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| ApprovalError::Unavailable)?;
            pending.insert(
                call_id.to_string(),
                Pending {
                    request_id: request_id.to_string(),
                    tx,
                },
            );
        }
        let outcome = async {
            if channel.send(event).is_err() {
                return Err(ApprovalError::Unavailable);
            }
            tokio::select! {
                biased;
                _ = cancel.changed() => Err(ApprovalError::Stopped),
                // A dropped sender means nobody approved: fail closed.
                result = rx => Ok(result.unwrap_or(ToolDecision::Rejected)),
                _ = tokio::time::sleep(timeout) => Ok(ToolDecision::Rejected),
            }
        }
        .await;
        self.remove(call_id);
        outcome
    }

    pub fn decide(
        &self,
        request_id: &str,
        call_id: &str,
        decision: ToolDecision,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "审批状态不可用")?;
        let Some(entry) = pending.remove(call_id) else {
            return Err("该调用已失效".into());
        };
        if entry.request_id != request_id {
            return Err("该调用已失效".into());
        }
        let _ = entry.tx.send(decision);
        Ok(())
    }

    /// Like `request`, but waits for a free-text answer instead of a decision.
    /// A dropped sender yields an empty answer, which the caller treats as
    /// "the user did not answer" — never as consent.
    pub async fn ask(
        &self,
        request_id: &str,
        call_id: &str,
        event: StreamEvent,
        channel: &Channel<StreamEvent>,
        cancel: &mut watch::Receiver<bool>,
        timeout: Duration,
    ) -> Result<String, ApprovalError> {
        if *cancel.borrow() {
            return Err(ApprovalError::Stopped);
        }
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .questions
                .lock()
                .map_err(|_| ApprovalError::Unavailable)?;
            pending.insert(
                call_id.to_string(),
                QuestionPending {
                    request_id: request_id.to_string(),
                    tx,
                },
            );
        }
        let outcome = async {
            if channel.send(event).is_err() {
                return Err(ApprovalError::Unavailable);
            }
            tokio::select! {
                biased;
                _ = cancel.changed() => Err(ApprovalError::Stopped),
                result = rx => Ok(result.unwrap_or_default()),
                _ = tokio::time::sleep(timeout) => Ok(String::new()),
            }
        }
        .await;
        if let Ok(mut pending) = self.questions.lock() {
            pending.remove(call_id);
        }
        outcome
    }

    pub fn answer(&self, request_id: &str, call_id: &str, text: String) -> Result<(), String> {
        let mut pending = self.questions.lock().map_err(|_| "审批状态不可用")?;
        let Some(entry) = pending.remove(call_id) else {
            return Err("该提问已失效".into());
        };
        if entry.request_id != request_id {
            return Err("该提问已失效".into());
        }
        let _ = entry.tx.send(text);
        Ok(())
    }

    /// Unblocks a suspended approval so cancel, reset and app exit never hang.
    pub fn drain(&self, decision: ToolDecision) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, entry) in pending.drain() {
                let _ = entry.tx.send(decision);
            }
        }
        if let Ok(mut pending) = self.questions.lock() {
            for (_, entry) in pending.drain() {
                let _ = entry.tx.send(String::new());
            }
        }
    }

    fn remove(&self, call_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(call_id);
        }
    }

    #[cfg(test)]
    pub fn pending_len(&self) -> usize {
        self.pending.lock().map(|value| value.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_assistant::types::Request;

    fn event() -> StreamEvent {
        let request: Request = serde_json::from_value(serde_json::json!({
            "requestId":"r1","conversationId":"c1","messageId":"m1","providerId":"p1","modelId":"model",
            "systemPrompt":"","parameters":{"historyRounds":0},
            "messages":[{"id":"u1","role":"user","content":"q","attachments":[],"createdAt":1,"status":"complete"}]
        }))
        .unwrap();
        request.event("approval_required", None, None)
    }

    fn channel() -> Channel<StreamEvent> {
        Channel::new(|_| Ok(()))
    }

    #[tokio::test]
    async fn ai_assistant_approval_timeout_rejects_and_clears_entry() {
        let registry = ApprovalRegistry::default();
        let (_sender, mut cancel) = watch::channel(false);
        let decision = registry
            .request(
                "r1",
                "call-1",
                event(),
                &channel(),
                &mut cancel,
                Duration::from_millis(20),
            )
            .await
            .unwrap();
        assert_eq!(decision, ToolDecision::Rejected);
        assert_eq!(registry.pending_len(), 0);
    }

    #[tokio::test]
    async fn ai_assistant_approval_decision_reaches_waiter_and_clears_entry() {
        let registry = std::sync::Arc::new(ApprovalRegistry::default());
        let (_sender, mut cancel) = watch::channel(false);
        let waiter = {
            let registry = registry.clone();
            let channel = channel();
            tokio::spawn(async move {
                registry
                    .request(
                        "r1",
                        "call-1",
                        event(),
                        &channel,
                        &mut cancel,
                        Duration::from_secs(30),
                    )
                    .await
            })
        };
        for _ in 0..200 {
            if registry.pending_len() == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        registry
            .decide("r1", "call-1", ToolDecision::Approved)
            .unwrap();
        assert_eq!(waiter.await.unwrap().unwrap(), ToolDecision::Approved);
        assert_eq!(registry.pending_len(), 0);
    }

    #[tokio::test]
    async fn ai_assistant_approval_rejects_stale_and_cross_request_answers() {
        let registry = std::sync::Arc::new(ApprovalRegistry::default());
        assert!(registry
            .decide("r1", "absent", ToolDecision::Approved)
            .is_err());
        let (_sender, mut cancel) = watch::channel(false);
        let waiter = {
            let registry = registry.clone();
            let channel = channel();
            tokio::spawn(async move {
                registry
                    .request(
                        "r1",
                        "call-1",
                        event(),
                        &channel,
                        &mut cancel,
                        Duration::from_secs(30),
                    )
                    .await
            })
        };
        for _ in 0..200 {
            if registry.pending_len() == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(registry
            .decide("other-request", "call-1", ToolDecision::Approved)
            .is_err());
        registry.drain(ToolDecision::Rejected);
        assert_eq!(waiter.await.unwrap().unwrap(), ToolDecision::Rejected);
        assert_eq!(registry.pending_len(), 0);
    }

    #[tokio::test]
    async fn ai_assistant_approval_cancel_unblocks_and_clears_entry() {
        let registry = std::sync::Arc::new(ApprovalRegistry::default());
        let (sender, mut cancel) = watch::channel(false);
        let waiter = {
            let registry = registry.clone();
            let channel = channel();
            tokio::spawn(async move {
                registry
                    .request(
                        "r1",
                        "call-1",
                        event(),
                        &channel,
                        &mut cancel,
                        Duration::from_secs(30),
                    )
                    .await
            })
        };
        for _ in 0..200 {
            if registry.pending_len() == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        sender.send(true).unwrap();
        assert!(matches!(waiter.await.unwrap(), Err(ApprovalError::Stopped)));
        assert_eq!(registry.pending_len(), 0);
    }
}
