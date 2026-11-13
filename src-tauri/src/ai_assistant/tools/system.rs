use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "get_system_info";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "获取用户本机的操作系统、CPU 架构、逻辑核心数与主机名等基础信息。无需参数，只读，不涉及文件内容。当回答依赖用户平台（如路径写法、命令语法）时使用。".into(),
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
    let cores = std::thread::available_parallelism()
        .map(|value| value.get().to_string())
        .unwrap_or_else(|_| "未知".into());
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "未知".into());
    ToolOutcome::ok(format!(
        "操作系统：{}\n系统家族：{}\nCPU 架构：{}\n逻辑核心数：{cores}\n主机名：{hostname}",
        std::env::consts::OS,
        std::env::consts::FAMILY,
        std::env::consts::ARCH,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_assistant_tools_system_info_reports_platform() {
        let outcome = run(&json!({}));
        assert!(!outcome.is_error);
        assert!(outcome.content.contains(std::env::consts::OS));
        assert!(outcome.content.contains(std::env::consts::ARCH));
        assert!(outcome.content.contains("逻辑核心数："));
    }
}
