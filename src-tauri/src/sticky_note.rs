use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const STICKY_NOTE_WINDOW_LABEL: &str = "sticky-note";
const STICKY_NOTE_PAGE_PATH: &str = "sticky-note.html";
const STICKY_NOTE_FILE_NAME: &str = "sticky-note.json";
const MAX_NOTE_LENGTH: usize = 50_000;
const STICKY_NOTE_WINDOW_WIDTH: f64 = 500.0;
const STICKY_NOTE_WINDOW_HEIGHT: f64 = 460.0;
const STICKY_NOTE_WINDOW_MIN_WIDTH: f64 = 440.0;
const STICKY_NOTE_WINDOW_MIN_HEIGHT: f64 = 340.0;
/// 便签使用无边框外观，标题栏由前端绘制并交给 Rust 原生拖动 API 处理。
const STICKY_NOTE_NATIVE_DECORATIONS: bool = false;
/// 原生窗口不使用透明背景，避免透明 WebView 拦截鼠标输入。
const STICKY_NOTE_TRANSPARENT: bool = false;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StickyNoteShortcutAction {
    Hide,
    Show,
}

fn decide_sticky_note_shortcut_action(is_visible: Option<bool>) -> StickyNoteShortcutAction {
    if is_visible == Some(true) {
        StickyNoteShortcutAction::Hide
    } else {
        StickyNoteShortcutAction::Show
    }
}

/// 悬浮便签的本地持久化数据。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StickyNote {
    pub content: String,
    pub color: String,
    pub always_on_top: bool,
}

/// 单张便签的数据。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StickyNoteItem {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    /// 便签呈现方式：plain 普通便签，timeline 时间轴便签。
    pub mode: String,
}

/// 悬浮窗口内的便签集合。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StickyNotesDocument {
    pub notes: Vec<StickyNoteItem>,
    pub active_id: String,
    pub always_on_top: bool,
}

impl Default for StickyNote {
    fn default() -> Self {
        Self {
            content: String::new(),
            color: "yellow".to_string(),
            always_on_top: true,
        }
    }
}

impl Default for StickyNoteItem {
    fn default() -> Self {
        Self {
            id: "note-1".to_string(),
            title: "便签 1".to_string(),
            content: String::new(),
            color: "yellow".to_string(),
            mode: "plain".to_string(),
        }
    }
}

impl Default for StickyNotesDocument {
    fn default() -> Self {
        Self {
            notes: vec![StickyNoteItem::default()],
            active_id: "note-1".to_string(),
            always_on_top: true,
        }
    }
}

fn sticky_note_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(STICKY_NOTE_FILE_NAME)
}

fn normalize_note(mut note: StickyNote) -> StickyNote {
    if note.content.len() > MAX_NOTE_LENGTH {
        note.content = note.content.chars().take(MAX_NOTE_LENGTH).collect();
    }

    if !matches!(
        note.color.as_str(),
        "yellow" | "lime" | "pink" | "blue" | "purple"
    ) {
        note.color = StickyNote::default().color;
    }
    note
}

fn normalize_document(mut document: StickyNotesDocument) -> StickyNotesDocument {
    if document.notes.is_empty() {
        document.notes.push(StickyNoteItem::default());
    }

    for (index, note) in document.notes.iter_mut().enumerate() {
        if note.id.trim().is_empty() {
            note.id = format!("note-{}", index + 1);
        }
        if note.title.trim().is_empty() {
            note.title = format!("便签 {}", index + 1);
        }
        if note.content.len() > MAX_NOTE_LENGTH {
            note.content = note.content.chars().take(MAX_NOTE_LENGTH).collect();
        }
        if !matches!(
            note.color.as_str(),
            "yellow" | "lime" | "pink" | "blue" | "purple"
        ) {
            note.color = "yellow".to_string();
        }
        if !matches!(note.mode.as_str(), "plain" | "timeline") {
            note.mode = "plain".to_string();
        }
    }

    if !document
        .notes
        .iter()
        .any(|note| note.id == document.active_id)
    {
        document.active_id = document.notes[0].id.clone();
    }
    document
}

fn save_sticky_note<T: Serialize>(app: &AppHandle, note: &T) -> Result<(), String> {
    let path = sticky_note_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建便签配置目录: {error}"))?;
    }
    let content = serde_json::to_string_pretty(note)
        .map_err(|error| format!("无法序列化便签内容: {error}"))?;
    std::fs::write(path, content).map_err(|error| format!("无法保存便签内容: {error}"))
}

/// 读取本地便签；配置缺失或损坏时返回一个新的空白便签。
#[tauri::command]
pub fn get_sticky_note(app: AppHandle) -> StickyNote {
    std::fs::read_to_string(sticky_note_path(&app))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .map(normalize_note)
        .unwrap_or_default()
}

/// 读取便签集合，并兼容首版单张便签配置。
#[tauri::command]
pub fn get_sticky_notes(app: AppHandle) -> StickyNotesDocument {
    let path = sticky_note_path(&app);
    let Some(content) = std::fs::read_to_string(path).ok() else {
        return StickyNotesDocument::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return StickyNotesDocument::default();
    };

    if value.get("notes").is_some() {
        serde_json::from_value(value)
            .map(normalize_document)
            .unwrap_or_default()
    } else {
        let legacy = serde_json::from_value::<StickyNote>(value).unwrap_or_default();
        let document = StickyNotesDocument {
            always_on_top: legacy.always_on_top,
            notes: vec![StickyNoteItem {
                content: legacy.content,
                color: legacy.color,
                ..StickyNoteItem::default()
            }],
            ..StickyNotesDocument::default()
        };
        normalize_document(document)
    }
}

/// 保存便签集合，并立即同步窗口置顶状态。
#[tauri::command]
pub fn update_sticky_notes(
    app: AppHandle,
    document: StickyNotesDocument,
) -> Result<StickyNotesDocument, String> {
    let document = normalize_document(document);
    if let Some(window) = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL) {
        window
            .set_always_on_top(document.always_on_top)
            .map_err(|error| format!("无法更新便签置顶状态: {error}"))?;
    }
    save_sticky_note(&app, &document)?;
    Ok(document)
}

/// 保存便签内容，并立即将置顶偏好应用到悬浮窗口。
#[tauri::command]
pub fn update_sticky_note(app: AppHandle, note: StickyNote) -> Result<StickyNote, String> {
    let note = normalize_note(note);
    if let Some(window) = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL) {
        window
            .set_always_on_top(note.always_on_top)
            .map_err(|error| format!("无法更新便签置顶状态: {error}"))?;
    }
    save_sticky_note(&app, &note)?;
    Ok(note)
}

/// 关闭便签仅隐藏窗口，确保内容和当前应用会话不受影响。
#[tauri::command]
pub fn hide_sticky_note(app: AppHandle) {
    if let Some(window) = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

/// 由全局快捷键调用：已显示时隐藏，否则恢复、显示并聚焦便签窗口。
pub fn toggle_sticky_note(app: &AppHandle) {
    let window = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL);
    let is_visible =
        window.as_ref().and_then(
            |window| match (window.is_visible(), window.is_minimized()) {
                (Ok(true), Ok(false)) => Some(true),
                (Ok(false), _) | (Ok(true), Ok(true)) => Some(false),
                _ => None,
            },
        );

    match decide_sticky_note_shortcut_action(is_visible) {
        StickyNoteShortcutAction::Hide => {
            if let Some(window) = window {
                let _ = window.hide();
            }
        }
        StickyNoteShortcutAction::Show => show_sticky_note(app),
    }
}

/// 使用 Tauri/Wry 原生窗口拖动能力移动便签窗口。
fn start_dragging_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|error| format!("无法拖动便签窗口: {error}"))
}

#[tauri::command]
pub fn start_sticky_note_drag(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(STICKY_NOTE_WINDOW_LABEL)
        .ok_or_else(|| "便签窗口尚未创建".to_string())?;
    start_dragging_window(&window)
}

/// 立即切换原生窗口置顶状态；文档保存仍由前端的自动保存流程负责。
#[tauri::command]
pub fn set_sticky_note_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(STICKY_NOTE_WINDOW_LABEL)
        .ok_or_else(|| "便签窗口尚未创建".to_string())?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("无法切换便签置顶状态: {error}"))
}

/// 由全局快捷键调用，恢复、显示并聚焦便签窗口。
pub fn show_sticky_note(app: &AppHandle) {
    let always_on_top = get_sticky_notes(app.clone()).always_on_top;
    let window = if let Some(window) = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL) {
        window
    } else {
        match WebviewWindowBuilder::new(
            app,
            STICKY_NOTE_WINDOW_LABEL,
            WebviewUrl::App(STICKY_NOTE_PAGE_PATH.into()),
        )
        .title("便签")
        .inner_size(STICKY_NOTE_WINDOW_WIDTH, STICKY_NOTE_WINDOW_HEIGHT)
        .min_inner_size(STICKY_NOTE_WINDOW_MIN_WIDTH, STICKY_NOTE_WINDOW_MIN_HEIGHT)
        .resizable(true)
        // 无边框窗口由自定义标题栏触发 Rust 原生拖动命令。
        .decorations(STICKY_NOTE_NATIVE_DECORATIONS)
        .transparent(STICKY_NOTE_TRANSPARENT)
        .always_on_top(always_on_top)
        .skip_taskbar(false)
        .center()
        .build()
        {
            Ok(window) => window,
            Err(error) => {
                eprintln!("创建便签原生窗口失败: {error}");
                return;
            }
        }
    };

    let _ = window.set_always_on_top(always_on_top);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// 供主窗口中的“便签”工具页显式唤出独立悬浮窗口。
#[tauri::command]
pub fn show_sticky_note_window(app: AppHandle) {
    show_sticky_note(&app);
}

#[cfg(test)]
mod tests {
    use super::{
        decide_sticky_note_shortcut_action, normalize_note, StickyNote, StickyNoteShortcutAction,
        StickyNotesDocument, MAX_NOTE_LENGTH, STICKY_NOTE_NATIVE_DECORATIONS,
        STICKY_NOTE_PAGE_PATH, STICKY_NOTE_TRANSPARENT, STICKY_NOTE_WINDOW_HEIGHT,
        STICKY_NOTE_WINDOW_MIN_HEIGHT, STICKY_NOTE_WINDOW_MIN_WIDTH, STICKY_NOTE_WINDOW_WIDTH,
    };

    #[test]
    fn 非法颜色会回退为默认颜色() {
        let note = normalize_note(StickyNote {
            color: "red".to_string(),
            ..StickyNote::default()
        });
        assert_eq!(note.color, "yellow");
    }

    #[test]
    fn 内容长度受限以保护配置文件() {
        let note = normalize_note(StickyNote {
            content: "a".repeat(MAX_NOTE_LENGTH + 1),
            ..StickyNote::default()
        });
        assert_eq!(note.content.len(), MAX_NOTE_LENGTH);
    }

    #[test]
    fn 便签快捷键在窗口可见时隐藏其他状态时显示() {
        assert_eq!(
            decide_sticky_note_shortcut_action(Some(true)),
            StickyNoteShortcutAction::Hide
        );
        assert_eq!(
            decide_sticky_note_shortcut_action(Some(false)),
            StickyNoteShortcutAction::Show
        );
        assert_eq!(
            decide_sticky_note_shortcut_action(None),
            StickyNoteShortcutAction::Show
        );
    }

    #[test]
    fn 默认窗口使用_rust_原生拖动并默认置顶() {
        assert!(StickyNotesDocument::default().always_on_top);
        assert!(STICKY_NOTE_WINDOW_WIDTH >= STICKY_NOTE_WINDOW_MIN_WIDTH);
        assert!(STICKY_NOTE_WINDOW_HEIGHT >= STICKY_NOTE_WINDOW_MIN_HEIGHT);
        assert!(!STICKY_NOTE_NATIVE_DECORATIONS);
        assert!(!STICKY_NOTE_TRANSPARENT);
    }

    #[test]
    fn 便签窗口使用独立页面避免_about_blank_路由() {
        assert_eq!(STICKY_NOTE_PAGE_PATH, "sticky-note.html");
    }
}
