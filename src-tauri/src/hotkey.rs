use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// 快捷键动作类型
pub const ACTION_SHOW_WINDOW: &str = "showWindow";
pub const ACTION_STICKY_NOTE: &str = "stickyNote";
pub const ACTION_SCREENSHOT: &str = "screenshot";
pub const ACTION_LONGSHOT: &str = "longshot";
pub const ACTION_SCREEN_RECORDER: &str = "screenRecorder";

/// 默认快捷键绑定
pub fn default_bindings() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert(ACTION_SHOW_WINDOW.to_string(), "Ctrl+Shift+T".to_string());
    m.insert(ACTION_STICKY_NOTE.to_string(), "Ctrl+Alt+N".to_string());
    m.insert(ACTION_SCREENSHOT.to_string(), "Ctrl+Alt+A".to_string());
    m.insert(ACTION_LONGSHOT.to_string(), "Ctrl+Alt+S".to_string());
    m.insert(ACTION_SCREEN_RECORDER.to_string(), "Ctrl+Shift+R".to_string());
    m
}

/// 快捷键共享状态：action_id -> shortcut_string
pub struct HotkeyState {
    pub bindings: Mutex<HashMap<String, String>>,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self {
            bindings: Mutex::new(default_bindings()),
        }
    }
}

/// 从配置文件加载快捷键绑定（缺失的新增动作以默认值补齐）
pub fn load_hotkey_bindings(app: &tauri::AppHandle) -> HashMap<String, String> {
    let path = hotkey_config_path(app);
    let mut bindings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(default_bindings);
    for (action, shortcut) in default_bindings() {
        bindings.entry(action).or_insert(shortcut);
    }
    bindings
}

/// 保存快捷键绑定到配置文件
pub fn save_hotkey_bindings(app: &tauri::AppHandle, bindings: &HashMap<String, String>) {
    let path = hotkey_config_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(bindings).unwrap_or_default());
}

fn hotkey_config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("hotkeys.json")
}

/// 注册所有快捷键
pub fn register_all(app: &tauri::AppHandle) {
    let state = app.state::<HotkeyState>();
    let bindings = state.bindings.lock().unwrap();
    for (_action, shortcut_str) in bindings.iter() {
        if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
            let _ = app.global_shortcut().register(shortcut);
        }
    }
}

/// 注销所有快捷键
pub fn unregister_all(app: &tauri::AppHandle) {
    let state = app.state::<HotkeyState>();
    let bindings = state.bindings.lock().unwrap();
    for (_action, shortcut_str) in bindings.iter() {
        if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }
}

/// 根据快捷键字符串查找对应的动作
pub fn find_action(app: &tauri::AppHandle, shortcut: &Shortcut) -> Option<String> {
    let state = app.state::<HotkeyState>();
    let bindings = state.bindings.lock().unwrap();
    for (action, shortcut_str) in bindings.iter() {
        if let Ok(parsed) = shortcut_str.parse::<Shortcut>() {
            if &parsed == shortcut {
                return Some(action.clone());
            }
        }
    }
    None
}

/// Tauri 命令：更新快捷键绑定
#[tauri::command]
pub fn update_hotkey(
    app: tauri::AppHandle,
    action: String,
    shortcut: String,
) -> Result<(), String> {
    // 验证快捷键格式
    let new_shortcut: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("无效的快捷键格式: {}", shortcut))?;

    // 检查是否与其他动作冲突
    let state = app.state::<HotkeyState>();
    {
        let bindings = state.bindings.lock().unwrap();
        for (other_action, other_str) in bindings.iter() {
            if other_action != &action {
                if let Ok(parsed) = other_str.parse::<Shortcut>() {
                    if parsed == new_shortcut {
                        return Err(format!("快捷键已被「{}」占用", other_action));
                    }
                }
            }
        }
    }

    // 注销旧快捷键
    {
        let bindings = state.bindings.lock().unwrap();
        if let Some(old_str) = bindings.get(&action) {
            if let Ok(old_shortcut) = old_str.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(old_shortcut);
            }
        }
    }

    // 注册新快捷键
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("注册快捷键失败: {}", e))?;

    // 更新状态
    {
        let mut bindings = state.bindings.lock().unwrap();
        bindings.insert(action, shortcut);
        let bindings_clone = bindings.clone();
        drop(bindings);
        save_hotkey_bindings(&app, &bindings_clone);
    }

    Ok(())
}

/// Tauri 命令：获取当前快捷键绑定
#[tauri::command]
pub fn get_hotkeys(app: tauri::AppHandle) -> HashMap<String, String> {
    let state = app.state::<HotkeyState>();
    let result = state.bindings.lock().unwrap().clone();
    result
}

/// Tauri 命令：重置快捷键为默认值
#[tauri::command]
pub fn reset_hotkeys(app: tauri::AppHandle) -> Result<(), String> {
    // 注销所有
    unregister_all(&app);

    // 重置为默认
    let defaults = default_bindings();
    {
        let state = app.state::<HotkeyState>();
        let mut bindings = state.bindings.lock().unwrap();
        *bindings = defaults.clone();
    }

    // 重新注册
    register_all(&app);
    save_hotkey_bindings(&app, &defaults);

    Ok(())
}
