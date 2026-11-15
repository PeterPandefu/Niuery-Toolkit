use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub const CREATE_NAME: &str = "task_create";
pub const UPDATE_NAME: &str = "task_update";
pub const LIST_NAME: &str = "task_list";

/// Per-request todo state. It lives only for the current generation task and
/// is never written to the conversation store.
#[derive(Clone, Debug)]
pub struct TaskItem {
    pub id: u64,
    pub subject: String,
    pub description: String,
    pub status: String,
}

#[derive(Clone, Default)]
pub struct TaskBoard {
    inner: Arc<Mutex<Vec<TaskItem>>>,
}

const STATUSES: [&str; 4] = ["pending", "in_progress", "completed", "deleted"];

fn locked(board: &TaskBoard) -> Result<std::sync::MutexGuard<'_, Vec<TaskItem>>, ToolOutcome> {
    board
        .inner
        .lock()
        .map_err(|_| ToolOutcome::error("任务状态不可用。"))
}

fn render(tasks: &[TaskItem]) -> String {
    let visible: Vec<&TaskItem> = tasks
        .iter()
        .filter(|task| task.status != "deleted")
        .collect();
    if visible.is_empty() {
        return "任务清单为空。".to_string();
    }
    visible
        .iter()
        .map(|task| {
            format!(
                "#{} [{}] {} — {}",
                task.id, task.status, task.subject, task.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn create_spec() -> ToolSpec {
    ToolSpec {
        name: CREATE_NAME.into(),
        description: "为当前任务创建一个待办事项，用于拆解和跟踪多步工作。返回新任务编号与当前清单。仅在本次生成任务内有效。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "subject": { "type": "string", "description": "简短的任务标题，祈使句" },
                "description": { "type": "string", "description": "可选：需要做什么的说明" }
            },
            "required": ["subject"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default().with_read_only(false).with_open_world(false),
    }
}

pub fn update_spec() -> ToolSpec {
    ToolSpec {
        name: UPDATE_NAME.into(),
        description: "更新一个待办事项的状态或内容。状态只能是 pending、in_progress、completed、deleted。开始做某任务时标记 in_progress，完成并验证后标记 completed。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer", "description": "任务编号" },
                "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "deleted"], "description": "可选：新状态" },
                "subject": { "type": "string", "description": "可选：新标题" },
                "description": { "type": "string", "description": "可选：新说明" }
            },
            "required": ["id"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default().with_read_only(false).with_open_world(false),
    }
}

pub fn list_spec() -> ToolSpec {
    ToolSpec {
        name: LIST_NAME.into(),
        description: "列出当前任务的全部待办事项及其状态。无需参数。".into(),
        parameters: json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_open_world(false),
    }
}

pub fn create(arguments: &Value, board: &TaskBoard) -> ToolOutcome {
    let Some(subject) = arguments.get("subject").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 subject 参数，或它不是字符串。");
    };
    if subject.trim().is_empty() {
        return ToolOutcome::error("任务标题不能为空。");
    }
    let description = arguments
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let Ok(mut tasks) = locked(board) else {
        return ToolOutcome::error("任务状态不可用。");
    };
    let id = tasks.iter().map(|task| task.id).max().unwrap_or(0) + 1;
    tasks.push(TaskItem {
        id,
        subject: subject.trim().to_string(),
        description,
        status: "pending".into(),
    });
    ToolOutcome::ok(format!("已创建任务 #{id}。\n{}", render(&tasks)))
}

pub fn update(arguments: &Value, board: &TaskBoard) -> ToolOutcome {
    let Some(id) = arguments.get("id").and_then(Value::as_u64) else {
        return ToolOutcome::error("缺少 id 参数，或它不是整数。");
    };
    let status = arguments.get("status").and_then(Value::as_str);
    if let Some(status) = status {
        if !STATUSES.contains(&status) {
            return ToolOutcome::error("status 只能是 pending、in_progress、completed、deleted。");
        }
    }
    let Ok(mut tasks) = locked(board) else {
        return ToolOutcome::error("任务状态不可用。");
    };
    let Some(task) = tasks.iter_mut().find(|task| task.id == id) else {
        return ToolOutcome::error(format!("任务 #{id} 不存在。"));
    };
    if let Some(status) = status {
        task.status = status.to_string();
    }
    if let Some(subject) = arguments.get("subject").and_then(Value::as_str) {
        if subject.trim().is_empty() {
            return ToolOutcome::error("任务标题不能为空。");
        }
        task.subject = subject.trim().to_string();
    }
    if let Some(description) = arguments.get("description").and_then(Value::as_str) {
        task.description = description.to_string();
    }
    ToolOutcome::ok(format!("已更新任务 #{id}。\n{}", render(&tasks)))
}

pub fn list(board: &TaskBoard) -> ToolOutcome {
    let Ok(tasks) = locked(board) else {
        return ToolOutcome::error("任务状态不可用。");
    };
    ToolOutcome::ok(render(&tasks))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_assistant_tools_tasks_create_update_and_list() {
        let board = TaskBoard::default();
        let outcome = create(
            &json!({ "subject": "第一步", "description": "调研" }),
            &board,
        );
        assert!(!outcome.is_error);
        assert!(outcome.content.contains("#1 [pending] 第一步"));
        let outcome = update(&json!({ "id": 1, "status": "in_progress" }), &board);
        assert!(!outcome.is_error);
        let outcome = list(&board);
        assert!(outcome.content.contains("[in_progress]"));
        let outcome = update(&json!({ "id": 1, "status": "completed" }), &board);
        assert!(!outcome.is_error);
        assert!(list(&board).content.contains("[completed]"));
    }

    #[test]
    fn ai_assistant_tools_tasks_deleted_disappear_and_bad_input_fails() {
        let board = TaskBoard::default();
        create(&json!({ "subject": "a" }), &board);
        create(&json!({ "subject": "b" }), &board);
        update(&json!({ "id": 1, "status": "deleted" }), &board);
        let listed = list(&board).content;
        assert!(!listed.contains("a"));
        assert!(listed.contains("#2"));
        assert!(update(&json!({ "id": 99, "status": "completed" }), &board).is_error);
        assert!(update(&json!({ "id": 2, "status": "bogus" }), &board).is_error);
        assert!(create(&json!({ "subject": "  " }), &board).is_error);
        assert!(create(&json!({}), &board).is_error);
        // Ids never reuse a deleted slot.
        let outcome = create(&json!({ "subject": "c" }), &board);
        assert!(outcome.content.contains("#3"));
    }
}
