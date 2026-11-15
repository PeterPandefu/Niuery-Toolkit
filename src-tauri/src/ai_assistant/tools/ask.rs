use super::{ApprovalLevel, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::json;

pub const NAME: &str = "ask_user";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "当任务缺少只有用户才能提供的信息（偏好、选择、凭据之外的澄清）时，向用户提出一个问题并等待回答。弹出输入对话框，可附带候选项。不要用它询问可以通过只读工具自行查到的信息，也不要频繁打断用户。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "question": { "type": "string", "description": "要问用户的问题，清晰具体" },
                "options": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选：2-4 个候选答案，用户也可以自由输入"
                }
            },
            "required": ["question"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(false),
    }
}
