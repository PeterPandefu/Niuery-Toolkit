use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window,
};

const STICKY_NOTE_WINDOW_LABEL: &str = "sticky-note";
const STICKY_NOTE_PAGE_PATH: &str = "sticky-note.html";
const STICKY_NOTE_FILE_NAME: &str = "sticky-note.json";
const MAX_NOTE_LENGTH: usize = 50_000;
const STICKY_NOTE_WINDOW_WIDTH: f64 = 500.0;
const STICKY_NOTE_WINDOW_HEIGHT: f64 = 460.0;
const STICKY_NOTE_WINDOW_MIN_WIDTH: f64 = 440.0;
const STICKY_NOTE_WINDOW_MIN_HEIGHT: f64 = 340.0;
const EDGE_HIDE_TRIGGER_DISTANCE: i32 = 16;
const EDGE_HIDE_REVEAL_SIZE: i32 = 4;
// Windows 无边框窗口的外框坐标可能比可见内容多出一个贴边触发距离。
const EDGE_HIDE_POSITION_TOLERANCE: u32 = EDGE_HIDE_TRIGGER_DISTANCE as u32;
const EDGE_HIDE_DELAY: Duration = Duration::from_millis(120);
const EDGE_HIDE_REVEAL_DURATION: Duration = Duration::from_millis(220);
const EDGE_HIDE_COLLAPSE_DURATION: Duration = Duration::from_millis(150);
static STICKY_NOTE_EDGE_REVEAL_WATCHING: AtomicBool = AtomicBool::new(false);
static STICKY_NOTE_EDGE_ANIMATING: AtomicBool = AtomicBool::new(false);
/// 便签使用无边框外观，标题栏由前端绘制并交给 Rust 原生拖动 API 处理。
const STICKY_NOTE_NATIVE_DECORATIONS: bool = false;
/// 原生窗口不使用透明背景，避免透明 WebView 拦截鼠标输入。
const STICKY_NOTE_TRANSPARENT: bool = false;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StickyNoteShortcutAction {
    Hide,
    Show,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StickyNoteHiddenEdge {
    Left,
    Top,
    Right,
}

fn decide_sticky_note_shortcut_action(is_visible: Option<bool>) -> StickyNoteShortcutAction {
    if is_visible == Some(true) {
        StickyNoteShortcutAction::Hide
    } else {
        StickyNoteShortcutAction::Show
    }
}

fn edge_hide_target(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> Option<(StickyNoteHiddenEdge, PhysicalPosition<i32>)> {
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;
    let window_right = position.x + size.width as i32;
    let window_bottom = position.y + size.height as i32;
    let overlaps_vertically = position.y < monitor_bottom && window_bottom > monitor_position.y;
    let overlaps_horizontally = position.x < monitor_right && window_right > monitor_position.x;

    // 原生拖动会保留鼠标按下点到窗口左上角的偏移。横向拖到屏幕边缘时，
    // 窗口可能已越过边界数十像素；只要其可见边缘已到达或越过边界即应收起。
    if overlaps_vertically
        && overlaps_horizontally
        && position.x <= monitor_position.x + EDGE_HIDE_TRIGGER_DISTANCE
    {
        return Some((
            StickyNoteHiddenEdge::Left,
            PhysicalPosition::new(
                monitor_position.x - size.width as i32 + EDGE_HIDE_REVEAL_SIZE,
                position.y,
            ),
        ));
    }

    if overlaps_horizontally
        && position.y >= monitor_position.y - EDGE_HIDE_POSITION_TOLERANCE as i32
        && position.y <= monitor_position.y + EDGE_HIDE_TRIGGER_DISTANCE
    {
        return Some((
            StickyNoteHiddenEdge::Top,
            PhysicalPosition::new(
                position.x,
                monitor_position.y - size.height as i32 + EDGE_HIDE_REVEAL_SIZE,
            ),
        ));
    }

    if overlaps_vertically
        && overlaps_horizontally
        && window_right >= monitor_right - EDGE_HIDE_TRIGGER_DISTANCE
    {
        return Some((
            StickyNoteHiddenEdge::Right,
            PhysicalPosition::new(monitor_right - EDGE_HIDE_REVEAL_SIZE, position.y),
        ));
    }

    None
}

#[cfg(test)]
fn edge_hidden_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> Option<PhysicalPosition<i32>> {
    edge_hide_target(position, size, monitor_position, monitor_size)
        .map(|(_, hidden_position)| hidden_position)
}

fn monitor_has_adjacent_neighbor(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    edge: StickyNoteHiddenEdge,
    monitors: &[(PhysicalPosition<i32>, PhysicalSize<u32>)],
) -> bool {
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let window_right = position.x + size.width as i32;
    let window_bottom = position.y + size.height as i32;

    monitors.iter().any(|(other_position, other_size)| {
        let other_right = other_position.x + other_size.width as i32;
        let other_bottom = other_position.y + other_size.height as i32;
        let shares_candidate_edge = match edge {
            StickyNoteHiddenEdge::Left => {
                other_right == monitor_position.x
                    && position.y < other_bottom
                    && window_bottom > other_position.y
            }
            StickyNoteHiddenEdge::Top => {
                other_bottom == monitor_position.y
                    && position.x < other_right
                    && window_right > other_position.x
            }
            StickyNoteHiddenEdge::Right => {
                other_position.x == monitor_right
                    && position.y < other_bottom
                    && window_bottom > other_position.y
            }
        };

        // 只要与相邻显示器有一个物理像素相交，也保守地认定为内部接缝，
        // 避免跨屏窗口在布局错位的显示器边缘意外收起。
        shares_candidate_edge
    })
}

fn edge_hidden_position_from_monitors(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitors: &[(PhysicalPosition<i32>, PhysicalSize<u32>)],
) -> Option<PhysicalPosition<i32>> {
    monitors
        .iter()
        .find_map(|(monitor_position, monitor_size)| {
            let (edge, hidden_position) =
                edge_hide_target(position, size, *monitor_position, *monitor_size)?;
            if monitor_has_adjacent_neighbor(
                position,
                size,
                *monitor_position,
                *monitor_size,
                edge,
                monitors,
            ) {
                None
            } else {
                Some(hidden_position)
            }
        })
}

fn edge_expanded_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> Option<PhysicalPosition<i32>> {
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let window_right = position.x + size.width as i32;
    let window_bottom = position.y + size.height as i32;
    let overlaps_vertically = position.y < monitor_position.y + monitor_size.height as i32
        && window_bottom > monitor_position.y;
    let overlaps_horizontally = position.x < monitor_right && window_right > monitor_position.x;

    if overlaps_vertically && is_near_edge(window_right, monitor_position.x + EDGE_HIDE_REVEAL_SIZE)
    {
        return Some(PhysicalPosition::new(monitor_position.x, position.y));
    }

    if overlaps_horizontally
        && is_near_edge(window_bottom, monitor_position.y + EDGE_HIDE_REVEAL_SIZE)
    {
        return Some(PhysicalPosition::new(position.x, monitor_position.y));
    }

    if overlaps_vertically && is_near_edge(position.x, monitor_right - EDGE_HIDE_REVEAL_SIZE) {
        return Some(PhysicalPosition::new(
            monitor_right - size.width as i32,
            position.y,
        ));
    }

    None
}

fn edge_expanded_position_from_monitors(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitors: &[(PhysicalPosition<i32>, PhysicalSize<u32>)],
) -> Option<PhysicalPosition<i32>> {
    monitors
        .iter()
        .find_map(|(monitor_position, monitor_size)| {
            edge_expanded_position(position, size, *monitor_position, *monitor_size)
        })
}

fn available_monitor_bounds(
    app: &AppHandle,
) -> Result<Vec<(PhysicalPosition<i32>, PhysicalSize<u32>)>, String> {
    app.available_monitors()
        .map(|monitors| {
            monitors
                .iter()
                .map(|monitor| (*monitor.position(), *monitor.size()))
                .collect()
        })
        .map_err(|error| format!("无法读取便签显示器: {error}"))
}

fn is_near_edge(position: i32, expected_position: i32) -> bool {
    position.abs_diff(expected_position) <= EDGE_HIDE_POSITION_TOLERANCE
}

fn cursor_is_on_edge_reveal(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    cursor: PhysicalPosition<i32>,
) -> bool {
    if edge_expanded_position(position, size, monitor_position, monitor_size).is_none() {
        return false;
    }

    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;
    let window_right = position.x + size.width as i32;
    let window_bottom = position.y + size.height as i32;
    let within_window_y = cursor.y >= position.y.max(monitor_position.y)
        && cursor.y < window_bottom.min(monitor_bottom);
    let within_window_x = cursor.x >= position.x.max(monitor_position.x)
        && cursor.x < window_right.min(monitor_right);

    if is_near_edge(window_right, monitor_position.x + EDGE_HIDE_REVEAL_SIZE) {
        return within_window_y
            && cursor.x >= monitor_position.x
            && cursor.x < monitor_position.x + EDGE_HIDE_REVEAL_SIZE;
    }

    if is_near_edge(window_bottom, monitor_position.y + EDGE_HIDE_REVEAL_SIZE) {
        return within_window_x
            && cursor.y >= monitor_position.y
            && cursor.y < monitor_position.y + EDGE_HIDE_REVEAL_SIZE;
    }

    if is_near_edge(position.x, monitor_right - EDGE_HIDE_REVEAL_SIZE) {
        return within_window_y
            && cursor.x >= monitor_right - EDGE_HIDE_REVEAL_SIZE
            && cursor.x < monitor_right;
    }

    false
}

fn cursor_is_within_window(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    cursor: PhysicalPosition<i32>,
) -> bool {
    cursor.x >= position.x
        && cursor.x < position.x + size.width as i32
        && cursor.y >= position.y
        && cursor.y < position.y + size.height as i32
}

fn animated_position(
    start: PhysicalPosition<i32>,
    target: PhysicalPosition<i32>,
    progress: f32,
    revealing: bool,
) -> PhysicalPosition<i32> {
    let progress = progress.clamp(0.0, 1.0);
    let eased_progress = if revealing {
        1.0 - (1.0 - progress).powi(3)
    } else {
        progress.powi(3)
    };
    let interpolate =
        |from: i32, to: i32| from + ((to - from) as f32 * eased_progress).round() as i32;

    PhysicalPosition::new(
        interpolate(start.x, target.x),
        interpolate(start.y, target.y),
    )
}

async fn animate_sticky_note_position(
    window: WebviewWindow,
    start: PhysicalPosition<i32>,
    target: PhysicalPosition<i32>,
    duration: Duration,
    revealing: bool,
) {
    if start == target
        || STICKY_NOTE_EDGE_ANIMATING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }

    let animation_started_at = Instant::now();
    loop {
        let progress =
            (animation_started_at.elapsed().as_secs_f32() / duration.as_secs_f32()).min(1.0);
        let position = animated_position(start, target, progress, revealing);
        let _ = window.set_position(Position::Physical(position));

        if progress >= 1.0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
    }

    STICKY_NOTE_EDGE_ANIMATING.store(false, Ordering::Release);
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<PhysicalPosition<i32>> {
    use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};

    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point).ok()? };
    Some(PhysicalPosition::new(point.x, point.y))
}

#[cfg(not(target_os = "windows"))]
fn cursor_position() -> Option<PhysicalPosition<i32>> {
    None
}

fn watch_sticky_note_edge_reveal(app: AppHandle) {
    if STICKY_NOTE_EDGE_REVEAL_WATCHING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut cursor_left_at = None;

        loop {
            tokio::time::sleep(Duration::from_millis(25)).await;

            let Some(window) = app.get_webview_window(STICKY_NOTE_WINDOW_LABEL) else {
                break;
            };
            let Ok(true) = window.is_visible() else {
                break;
            };
            let (Ok(position), Ok(size), Ok(monitors)) = (
                window.outer_position(),
                window.outer_size(),
                available_monitor_bounds(&app),
            ) else {
                continue;
            };
            if let Some(expanded_position) =
                edge_expanded_position_from_monitors(position, size, &monitors)
            {
                cursor_left_at = None;
                if cursor_position().is_some_and(|cursor| {
                    monitors.iter().any(|(monitor_position, monitor_size)| {
                        cursor_is_on_edge_reveal(
                            position,
                            size,
                            *monitor_position,
                            *monitor_size,
                            cursor,
                        )
                    })
                }) {
                    animate_sticky_note_position(
                        window,
                        position,
                        expanded_position,
                        EDGE_HIDE_REVEAL_DURATION,
                        true,
                    )
                    .await;
                }
                continue;
            }

            let Some(hidden_position) =
                edge_hidden_position_from_monitors(position, size, &monitors)
            else {
                break;
            };
            let Some(cursor) = cursor_position() else {
                continue;
            };

            if cursor_is_within_window(position, size, cursor) {
                cursor_left_at = None;
                continue;
            }

            let left_at = cursor_left_at.get_or_insert_with(Instant::now);
            if left_at.elapsed() >= EDGE_HIDE_DELAY {
                animate_sticky_note_position(
                    window,
                    position,
                    hidden_position,
                    EDGE_HIDE_COLLAPSE_DURATION,
                    false,
                )
                .await;
                cursor_left_at = None;
            }
        }

        STICKY_NOTE_EDGE_REVEAL_WATCHING.store(false, Ordering::Release);
    });
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
    pub timeline_entries: Vec<TimelineEntry>,
}

/// 时间轴中的单条记录。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TimelineEntry {
    pub id: String,
    pub timestamp: String,
    pub content: String,
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
            timeline_entries: Vec::new(),
        }
    }
}

impl Default for TimelineEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            timestamp: String::new(),
            content: String::new(),
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
        if note.mode == "timeline" {
            // 旧版时间轴内容是多行纯文本，本版本不迁移，直接清空。
            note.content.clear();
        }
        note.timeline_entries
            .retain(|entry| !entry.content.trim().is_empty());
        for (entry_index, entry) in note.timeline_entries.iter_mut().enumerate() {
            if entry.id.trim().is_empty() {
                entry.id = format!("{}-timeline-{}", note.id, entry_index + 1);
            }
            if entry.content.len() > MAX_NOTE_LENGTH {
                entry.content = entry.content.chars().take(MAX_NOTE_LENGTH).collect();
            }
        }
        note.timeline_entries
            .sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
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

/// 窗口贴到显示器左、上、右边缘时开始监听鼠标离开事件。
pub fn hide_sticky_note_at_edge(window: &Window, position: PhysicalPosition<i32>) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(monitors) = available_monitor_bounds(window.app_handle()) else {
        return;
    };

    if edge_hidden_position_from_monitors(position, size, &monitors).is_some() {
        watch_sticky_note_edge_reveal(window.app_handle().clone());
    }
}

/// 鼠标进入贴边后露出的细小区域时，以原生动画恢复完整便签窗口。
#[tauri::command]
pub fn expand_sticky_note_from_edge(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(STICKY_NOTE_WINDOW_LABEL)
        .ok_or_else(|| "便签窗口尚未创建".to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| format!("无法读取便签窗口位置: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("无法读取便签窗口大小: {error}"))?;
    let monitors = available_monitor_bounds(&app)?;
    let Some(expanded_position) = edge_expanded_position_from_monitors(position, size, &monitors)
    else {
        return Ok(());
    };

    tauri::async_runtime::spawn(async move {
        animate_sticky_note_position(
            window,
            position,
            expanded_position,
            EDGE_HIDE_REVEAL_DURATION,
            true,
        )
        .await;
    });
    Ok(())
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
        // 禁止 Windows 顶部最大化和左右半屏贴靠，保留窗口边缘调整大小。
        .maximizable(false)
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
    let _ = window.set_maximizable(false);
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
        animated_position, cursor_is_on_edge_reveal, cursor_is_within_window,
        decide_sticky_note_shortcut_action, edge_expanded_position,
        edge_expanded_position_from_monitors, edge_hidden_position,
        edge_hidden_position_from_monitors, normalize_note, StickyNote, StickyNoteShortcutAction,
        StickyNotesDocument, MAX_NOTE_LENGTH, STICKY_NOTE_NATIVE_DECORATIONS,
        STICKY_NOTE_PAGE_PATH, STICKY_NOTE_TRANSPARENT, STICKY_NOTE_WINDOW_HEIGHT,
        STICKY_NOTE_WINDOW_MIN_HEIGHT, STICKY_NOTE_WINDOW_MIN_WIDTH, STICKY_NOTE_WINDOW_WIDTH,
    };
    use tauri::{PhysicalPosition, PhysicalSize};

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

    #[test]
    fn 贴到左上右边缘时只露出细小边缘并忽略普通位置() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(8, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(-496, 200))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(600, 8),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(600, -456))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(1_412, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(1_916, 200))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(600, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            None
        );
    }

    #[test]
    fn 贴边允许系统窗口坐标出现微小偏差() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(-8, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(-496, 200))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(600, -8),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(600, -456))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(1_428, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(1_916, 200))
        );
    }

    #[test]
    fn 贴边允许左右外框坐标偏差() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(-16, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(-496, 200))
        );
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(1_436, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(1_916, 200))
        );
    }

    #[test]
    fn 横向拖动跨过显示器边缘仍会触发收起() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        // 鼠标在标题栏中部按下后拖至屏幕左侧，窗口左上角会保留该横向偏移。
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(-85, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(-496, 200))
        );
        // 右侧同理：窗口右沿可能随按下点偏移越过显示器右边界。
        assert_eq!(
            edge_hidden_position(
                PhysicalPosition::new(1_620, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(1_916, 200))
        );
    }

    #[test]
    fn 鼠标进入露出边缘时恢复完整便签() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_expanded_position(
                PhysicalPosition::new(-496, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(0, 200))
        );
        assert_eq!(
            edge_expanded_position(
                PhysicalPosition::new(600, -456),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(600, 0))
        );
        assert_eq!(
            edge_expanded_position(
                PhysicalPosition::new(1_916, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(1_420, 200))
        );
        assert_eq!(
            edge_expanded_position(
                PhysicalPosition::new(600, 200),
                note_size,
                monitor_position,
                monitor_size,
            ),
            None
        );
    }

    #[test]
    fn 贴边恢复允许系统窗口坐标出现微小偏差() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_expanded_position(
                PhysicalPosition::new(600, -453),
                note_size,
                monitor_position,
                monitor_size,
            ),
            Some(PhysicalPosition::new(600, 0))
        );
    }

    #[test]
    fn 窗口完全移出屏幕后仍能从显示器列表定位恢复位置() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_expanded_position_from_monitors(
                PhysicalPosition::new(600, -456),
                note_size,
                &[(monitor_position, monitor_size)],
            ),
            Some(PhysicalPosition::new(600, 0))
        );
    }

    #[test]
    fn 贴边窗口可从显示器列表计算出收回位置() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(0, 200),
                note_size,
                &[(monitor_position, monitor_size)],
            ),
            Some(PhysicalPosition::new(-496, 200))
        );
    }

    #[test]
    fn 双屏内部交界不收起而外侧边界越界仍收起() {
        let left_monitor_position = PhysicalPosition::new(-1_920, 0);
        let right_monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);
        let monitors = [
            (left_monitor_position, monitor_size),
            (right_monitor_position, monitor_size),
        ];

        // 窗口跨越两台相邻显示器的内部交界，不能视为任一显示器的外侧边缘。
        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(-85, 200),
                note_size,
                &monitors,
            ),
            None
        );
        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(-2_000, 200),
                note_size,
                &monitors,
            ),
            Some(PhysicalPosition::new(-2_416, 200))
        );
        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(1_620, 200),
                note_size,
                &monitors,
            ),
            Some(PhysicalPosition::new(1_916, 200))
        );
    }

    #[test]
    fn 上下双屏内部交界不收起而顶部外侧边界仍收起() {
        let top_monitor_position = PhysicalPosition::new(0, -1_080);
        let bottom_monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);
        let monitors = [
            (top_monitor_position, monitor_size),
            (bottom_monitor_position, monitor_size),
        ];

        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(600, -8),
                note_size,
                &monitors,
            ),
            None
        );
        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(600, -1_090),
                note_size,
                &monitors,
            ),
            Some(PhysicalPosition::new(600, -1_536))
        );
    }

    #[test]
    fn 错位显示器仅一像素交界时保守不收起() {
        let upper_left_monitor = (PhysicalPosition::new(0, 0), PhysicalSize::new(1_920, 1_080));
        let lower_right_monitor = (
            PhysicalPosition::new(1_920, 1_079),
            PhysicalSize::new(1_920, 1_080),
        );
        let note_size = PhysicalSize::new(500, 460);

        assert_eq!(
            edge_hidden_position_from_monitors(
                PhysicalPosition::new(1_835, 1_079),
                note_size,
                &[upper_left_monitor, lower_right_monitor],
            ),
            None
        );
    }

    #[test]
    fn 收放动画保持起点和终点坐标() {
        let start = PhysicalPosition::new(600, -456);
        let target = PhysicalPosition::new(600, 0);

        assert_eq!(animated_position(start, target, 0.0, true), start);
        assert_eq!(animated_position(start, target, 1.0, true), target);
        assert_eq!(animated_position(target, start, 0.0, false), target);
        assert_eq!(animated_position(target, start, 1.0, false), start);
    }

    #[test]
    fn 鼠标离开完整便签范围后可触发收回() {
        let position = PhysicalPosition::new(0, 200);
        let size = PhysicalSize::new(500, 460);

        assert!(cursor_is_within_window(
            position,
            size,
            PhysicalPosition::new(499, 659),
        ));
        assert!(!cursor_is_within_window(
            position,
            size,
            PhysicalPosition::new(500, 659),
        ));
    }

    #[test]
    fn 鼠标进入顶部露出条时命中原生恢复区域() {
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_920, 1_080);
        let note_size = PhysicalSize::new(500, 460);
        let hidden_position = PhysicalPosition::new(600, -456);

        assert!(cursor_is_on_edge_reveal(
            hidden_position,
            note_size,
            monitor_position,
            monitor_size,
            PhysicalPosition::new(700, 2),
        ));
        assert!(!cursor_is_on_edge_reveal(
            hidden_position,
            note_size,
            monitor_position,
            monitor_size,
            PhysicalPosition::new(700, 8),
        ));
    }
}
