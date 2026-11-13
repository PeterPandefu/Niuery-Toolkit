use super::super::types::Message;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provenance {
    UserProvided,
    SearchDerived,
    ModelProposed,
}

impl Provenance {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserProvided => "userProvided",
            Self::SearchDerived => "searchDerived",
            Self::ModelProposed => "modelProposed",
        }
    }
}

/// Only the current request's user messages and their text attachments count.
/// A URL that appears solely in a historical assistant message or a historical
/// tool result never upgrades to a trusted source: history is not evidence.
pub fn user_corpus(messages: &[Message]) -> Vec<String> {
    messages
        .iter()
        .filter(|message| message.role == "user")
        .flat_map(|message| {
            std::iter::once(message.content.clone()).chain(
                message
                    .attachments
                    .iter()
                    .filter(|file| file.kind == "text")
                    .map(|file| file.data.clone()),
            )
        })
        .collect()
}

pub fn classify(url: &str, corpus: &[String], search_urls: &HashSet<String>) -> Provenance {
    let target = normalize(url);
    if search_urls
        .iter()
        .any(|candidate| normalize(candidate) == target)
    {
        return Provenance::SearchDerived;
    }
    if corpus
        .iter()
        .flat_map(|text| urls_in(text))
        .any(|candidate| normalize(&candidate) == target)
    {
        return Provenance::UserProvided;
    }
    Provenance::ModelProposed
}

fn urls_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (start, _) in text
        .match_indices("http://")
        .chain(text.match_indices("https://"))
    {
        let rest = &text[start..];
        let end = rest
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | ']' | '，' | '。' | '；')
            })
            .unwrap_or(rest.len());
        found.push(rest[..end].to_string());
    }
    found
}

/// Normalisation is for matching only. The URL actually fetched is always the
/// byte-exact string the model supplied; this never rewrites a request.
fn normalize(url: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(url.trim()) else {
        return url.trim().to_string();
    };
    let mut host = parsed.host_str().unwrap_or("").to_lowercase();
    if let Some(port) = parsed.port() {
        host.push_str(&format!(":{port}"));
    }
    let path = parsed.path().trim_end_matches('/');
    let query = parsed
        .query()
        .map(|value| format!("?{value}"))
        .unwrap_or_default();
    format!("{}://{host}{path}{query}", parsed.scheme().to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: &str, content: &str) -> Message {
        serde_json::from_value(serde_json::json!({
            "id": format!("{role}-1"), "role": role, "content": content,
            "attachments": [], "createdAt": 1, "status": "complete"
        }))
        .unwrap()
    }

    #[test]
    fn ai_assistant_provenance_accepts_urls_from_the_current_user_message() {
        let corpus = user_corpus(&[message("user", "请看 https://example.com/a?x=1 这个页面")]);
        assert_eq!(
            classify("https://example.com/a?x=1", &corpus, &HashSet::new()),
            Provenance::UserProvided
        );
    }

    #[test]
    fn ai_assistant_provenance_never_trusts_history_only_urls() {
        // The URL appears only in an assistant turn and an old tool result.
        let corpus = user_corpus(&[
            message("user", "帮我查点资料"),
            message("assistant", "我之前用过 https://example.com/old"),
        ]);
        assert_eq!(
            classify("https://example.com/old", &corpus, &HashSet::new()),
            Provenance::ModelProposed
        );
    }

    #[test]
    fn ai_assistant_provenance_marks_search_results_and_unrelated_urls() {
        let corpus = user_corpus(&[message("user", "搜索一下")]);
        let mut searched = HashSet::new();
        searched.insert("https://example.com/found".to_string());
        assert_eq!(
            classify("https://example.com/found", &corpus, &searched),
            Provenance::SearchDerived
        );
        assert_eq!(
            classify("https://example.com/invented", &corpus, &searched),
            Provenance::ModelProposed
        );
    }

    #[test]
    fn ai_assistant_provenance_normalises_for_match_without_rewriting_request() {
        let corpus = user_corpus(&[message("user", "见 HTTPS://Example.com:443/a/")]);
        assert_eq!(
            classify("https://example.com/a", &corpus, &HashSet::new()),
            Provenance::UserProvided
        );
        // Path case stays significant.
        assert_eq!(
            classify("https://example.com/A", &corpus, &HashSet::new()),
            Provenance::ModelProposed
        );
    }

    #[test]
    fn ai_assistant_provenance_reads_urls_from_user_text_attachments() {
        let mut attached = message("user", "");
        attached.attachments.push(
            serde_json::from_value(serde_json::json!({
                "id":"f1","name":"links.txt","kind":"text","mimeType":"text/plain","size":24,
                "data":"https://example.com/from-file"
            }))
            .unwrap(),
        );
        let corpus = user_corpus(&[attached]);
        assert_eq!(
            classify("https://example.com/from-file", &corpus, &HashSet::new()),
            Provenance::UserProvided
        );
    }
}