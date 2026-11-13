use super::{ApprovalLevel, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::json;

pub const NAME: &str = "run_subagent";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "派生一个子代理独立完成一项调研或分析子任务。子代理使用同一模型，只能使用只读工具（读文件、列目录、glob、grep、搜索、抓取网页等），不能写文件或执行命令。它只把最终结论文本返回给你，中间过程不进入主对话。适合需要大量阅读但只关心结论的任务。每次调用都需用户批准。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "交给子代理的完整任务说明：要查什么、在哪查、期望得到什么结论。子代理看不到主对话历史，说明必须自包含。" }
            },
            "required": ["prompt"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Approve,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(true),
    }
}
