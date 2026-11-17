use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "get_current_time";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "获取本机当前的本地时间与 Unix 毫秒时间戳。无需参数。当用户询问当前时间、日期，或推理需要时间基准时使用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(false),
    }
}

pub fn run(_arguments: &Value) -> ToolOutcome {
    let now = chrono::Local::now();
    ToolOutcome::ok(format!(
        "本地时间：{}\nUnix 毫秒：{}",
        now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        now.timestamp_millis()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_assistant_tools_time_returns_local_time_and_epoch_millis() {
        let outcome = run(&json!({}));
        assert!(!outcome.is_error);
        assert!(outcome.content.contains("本地时间："));
        assert!(outcome.content.contains("Unix 毫秒："));
        let millis = outcome
            .content
            .split("Unix 毫秒：")
            .nth(1)
            .expect("含时间戳")
            .trim()
            .parse::<i64>()
            .expect("时间戳为整数");
        assert!(millis > 1_700_000_000_000);
    }

    #[test]
    fn ai_assistant_tools_time_ignores_unexpected_arguments() {
        assert!(!run(&json!({"timezone": "anything"})).is_error);
    }
}
