use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Serialize)]
pub struct OpenedTextFile {
    pub path: String,
    pub contents: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RecoverySnapshot {
    pub id: String,
    pub tool: String,
    pub content: String,
    pub document_path: Option<String>,
    pub updated_at: u64,
}

fn now_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("读取系统时间失败: {error}"))
}

fn safe_segment(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("恢复快照标识无效".into());
    }
    Ok(value)
}

fn recovery_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?
        .join("document-recovery");
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建恢复目录失败: {error}"))?;
    Ok(directory)
}

fn snapshot_path(app: &tauri::AppHandle, tool: &str, id: &str) -> Result<PathBuf, String> {
    Ok(recovery_directory(app)?.join(format!(
        "{}-{}.json",
        safe_segment(tool)?,
        safe_segment(id)?
    )))
}

/// 打开用户明确选择的 UTF-8 文本文档。
#[tauri::command]
pub fn open_text_file_dialog(
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<OpenedTextFile>, String> {
    let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let path = rfd::FileDialog::new()
        .add_filter(&filter_name, &extension_refs)
        .pick_file();

    match path {
        Some(path) => {
            let contents =
                std::fs::read_to_string(&path).map_err(|error| format!("读取文档失败: {error}"))?;
            Ok(Some(OpenedTextFile {
                path: path.to_string_lossy().into_owned(),
                contents,
            }))
        }
        None => Ok(None),
    }
}

fn selected_path(path: Option<PathBuf>) -> Option<String> {
    path.map(|path| path.to_string_lossy().into_owned())
}

/// 选择一个现有文件路径，不读取或修改其内容。
#[tauri::command]
pub fn pick_existing_file() -> Result<Option<String>, String> {
    Ok(selected_path(rfd::FileDialog::new().pick_file()))
}

/// 写入应用私有目录中的临时恢复快照，不覆盖用户原始文档。
#[tauri::command]
pub fn write_recovery_snapshot(
    app: tauri::AppHandle,
    tool: String,
    id: String,
    content: String,
    document_path: Option<String>,
) -> Result<(), String> {
    let snapshot = RecoverySnapshot {
        id: id.clone(),
        tool: tool.clone(),
        content,
        document_path,
        updated_at: now_millis()?,
    };
    let serialized =
        serde_json::to_vec(&snapshot).map_err(|error| format!("序列化恢复快照失败: {error}"))?;
    std::fs::write(snapshot_path(&app, &tool, &id)?, serialized)
        .map_err(|error| format!("写入恢复快照失败: {error}"))
}

/// 列出未过期的恢复快照，并清理超过 30 天的旧快照。
#[tauri::command]
pub fn list_recovery_snapshots(
    app: tauri::AppHandle,
    tool: String,
) -> Result<Vec<RecoverySnapshot>, String> {
    safe_segment(&tool)?;
    let directory = recovery_directory(&app)?;
    let now = now_millis()?;
    let max_age = 30 * 24 * 60 * 60 * 1000_u64;
    let mut snapshots = Vec::new();

    for entry in
        std::fs::read_dir(directory).map_err(|error| format!("读取恢复目录失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取恢复条目失败: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(contents) = std::fs::read(&path) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_slice::<RecoverySnapshot>(&contents) else {
            continue;
        };
        if now.saturating_sub(snapshot.updated_at) > max_age {
            let _ = std::fs::remove_file(path);
        } else if snapshot.tool == tool {
            snapshots.push(snapshot);
        }
    }
    snapshots.sort_by_key(|snapshot| std::cmp::Reverse(snapshot.updated_at));
    Ok(snapshots)
}

/// 清除一份恢复快照；显式保存或用户放弃恢复后调用。
#[tauri::command]
pub fn discard_recovery_snapshot(
    app: tauri::AppHandle,
    tool: String,
    id: String,
) -> Result<(), String> {
    let path = snapshot_path(&app, &tool, &id)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| format!("删除恢复快照失败: {error}"))?;
    }
    Ok(())
}

/// 通用文件保存：弹出系统保存对话框，将字节流写入用户选择的路径。
/// 前端处理结果（PDF / 图片 / zip 等）统一通过该命令落盘。
#[tauri::command]
pub fn save_file_dialog(
    bytes: Vec<u8>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let path = rfd::FileDialog::new()
        .add_filter(&filter_name, &ext_refs)
        .set_file_name(&default_name)
        .save_file();

    match path {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_selected_file_path_without_reading_its_contents() {
        assert_eq!(
            selected_path(Some(PathBuf::from(r"C:\\work\\locked.dll"))),
            Some(r"C:\\work\\locked.dll".to_string())
        );
        assert_eq!(selected_path(None), None);
    }
}
