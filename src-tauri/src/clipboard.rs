use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// ==================== Windows 剪贴板文件操作 FFI ====================

#[cfg(target_os = "windows")]
mod win_clipboard {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;

    const CF_HDROP: u32 = 15;
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[repr(C)]
    struct DROPFILES {
        p_files: u32,
        pt_x: i32,
        pt_y: i32,
        f_nc: i32,
        f_wide: i32,
    }

    extern "system" {
        fn OpenClipboard(hwnd: *mut std::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(format: u32) -> *mut std::ffi::c_void;
        fn SetClipboardData(format: u32, handle: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalLock(handle: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalUnlock(handle: *mut std::ffi::c_void) -> i32;
        fn GlobalAlloc(flags: u32, size: usize) -> *mut std::ffi::c_void;
        fn GlobalFree(handle: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalSize(handle: *mut std::ffi::c_void) -> usize;
    }

    /// 从剪贴板读取文件列表 (CF_HDROP)
    pub fn get_clipboard_files() -> Option<Vec<PathBuf>> {
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return None;
            }

            let handle = GetClipboardData(CF_HDROP);
            if handle.is_null() {
                CloseClipboard();
                return None;
            }

            let lock = GlobalLock(handle);
            if lock.is_null() {
                CloseClipboard();
                return None;
            }

            let drop_files = lock as *const DROPFILES;
            let offset = (*drop_files).p_files as usize;
            let is_wide = (*drop_files).f_wide != 0;

            let data_ptr = (lock as *const u8).add(offset);
            let total_size = GlobalSize(handle);
            if offset > total_size {
                GlobalUnlock(handle);
                CloseClipboard();
                return None;
            }
            let remaining = total_size - offset;

            let mut paths = Vec::new();

            if is_wide {
                // UTF-16 编码
                let wchar_ptr = data_ptr as *const u16;
                let max_chars = remaining / 2;
                let mut start = 0;
                let mut i = 0;
                while i < max_chars {
                    let ch = *wchar_ptr.add(i);
                    if ch == 0 {
                        if i == start {
                            break; // 双零结尾
                        }
                        let slice = std::slice::from_raw_parts(wchar_ptr.add(start), i - start);
                        let os_str = OsString::from_wide(slice);
                        paths.push(PathBuf::from(os_str));
                        start = i + 1;
                    }
                    i += 1;
                }
            } else {
                // ANSI 编码
                let mut start = 0;
                let mut i = 0;
                while i < remaining {
                    let ch = *data_ptr.add(i);
                    if ch == 0 {
                        if i == start {
                            break;
                        }
                        let slice = std::slice::from_raw_parts(data_ptr.add(start), i - start);
                        let s = String::from_utf8_lossy(slice).to_string();
                        paths.push(PathBuf::from(s));
                        start = i + 1;
                    }
                    i += 1;
                }
            }

            GlobalUnlock(handle);
            CloseClipboard();

            if paths.is_empty() { None } else { Some(paths) }
        }
    }

    /// 将文件列表写入剪贴板 (CF_HDROP)
    pub fn set_clipboard_files(paths: &[PathBuf]) -> Result<(), String> {
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("打开剪贴板失败".to_string());
            }

            // 计算所需内存大小
            let header_size = std::mem::size_of::<DROPFILES>();
            let mut data_size: usize = header_size;
            for path in paths {
                let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
                data_size += (wide.len() + 1) * 2; // +1 for null terminator
            }
            data_size += 2; // 双零结尾

            let handle = GlobalAlloc(GMEM_MOVEABLE, data_size);
            if handle.is_null() {
                CloseClipboard();
                return Err("分配内存失败".to_string());
            }

            let lock = GlobalLock(handle);
            if lock.is_null() {
                GlobalFree(handle);
                CloseClipboard();
                return Err("锁定内存失败".to_string());
            }

            // 写入 DROPFILES 头
            let drop_files = lock as *mut DROPFILES;
            (*drop_files).p_files = header_size as u32;
            (*drop_files).pt_x = 0;
            (*drop_files).pt_y = 0;
            (*drop_files).f_nc = 0;
            (*drop_files).f_wide = 1; // UTF-16

            // 写入文件路径
            let mut offset = header_size;
            let base = lock as *mut u8;
            for path in paths {
                let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
                let dest = base.add(offset) as *mut u16;
                for (j, &ch) in wide.iter().enumerate() {
                    *dest.add(j) = ch;
                }
                *dest.add(wide.len()) = 0; // null terminator
                offset += (wide.len() + 1) * 2;
            }
            // 双零结尾
            let end = base.add(offset) as *mut u16;
            *end = 0;

            GlobalUnlock(handle);

            if SetClipboardData(CF_HDROP, handle).is_null() {
                GlobalFree(handle);
                CloseClipboard();
                return Err("写入剪贴板失败".to_string());
            }

            CloseClipboard();
            Ok(())
        }
    }

    use std::os::windows::ffi::OsStrExt;
}

/// 剪贴板内容类型
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardContentType {
    Text,
    Image,
    Files,
}

/// 剪贴板历史记录条目
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClipboardEntry {
    pub id: String,
    pub content_type: ClipboardContentType,
    pub text: Option<String>,
    pub file_paths: Option<Vec<String>>,
    pub image_filename: Option<String>,
    pub preview: String,
    pub timestamp: u64,
}

/// 前端展示用的条目（包含图片缩略图 base64）
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClipboardEntryView {
    pub id: String,
    pub content_type: ClipboardContentType,
    pub text: Option<String>,
    pub file_paths: Option<Vec<String>>,
    pub image_thumbnail: Option<String>,
    pub preview: String,
    pub timestamp: u64,
}

/// 剪贴板历史状态
pub struct ClipboardHistoryState {
    pub entries: Mutex<Vec<ClipboardEntry>>,
    pub config_dir: Mutex<PathBuf>,
    /// 用于防止监控线程与手动复制操作冲突
    pub clipboard_lock: Mutex<()>,
}

impl Default for ClipboardHistoryState {
    fn default() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            config_dir: Mutex::new(PathBuf::from(".")),
            clipboard_lock: Mutex::new(()),
        }
    }
}

const MAX_ENTRIES: usize = 200;
const MAX_TEXT_SIZE: usize = 10 * 1024; // 10KB
const POLL_INTERVAL_MS: u64 = 800;

/// 获取当前时间戳（毫秒）
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 计算字符串的 SHA256 hash
fn hash_str(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 计算字节数组的 SHA256 hash
fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// 历史文件路径
fn history_path(config_dir: &PathBuf) -> PathBuf {
    config_dir.join("clipboard_history.json")
}

/// 图片目录路径
fn images_dir(config_dir: &PathBuf) -> PathBuf {
    config_dir.join("clipboard_images")
}

/// 从磁盘加载历史记录
fn load_history(config_dir: &PathBuf) -> Vec<ClipboardEntry> {
    let path = history_path(config_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 保存历史记录到磁盘
fn save_history(config_dir: &PathBuf, entries: &[ClipboardEntry]) {
    let path = history_path(config_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(entries).unwrap_or_default());
}

/// 保存图片到磁盘，返回文件名
fn save_image(config_dir: &PathBuf, rgba_data: &[u8], width: usize, height: usize) -> Option<String> {
    let dir = images_dir(config_dir);
    let _ = std::fs::create_dir_all(&dir);

    let filename = format!("{}.png", nanoid::nanoid!(12));
    let filepath = dir.join(&filename);

    // 使用 image crate 编码为 PNG
    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba_data.to_vec())?;
    img.save(&filepath).ok()?;

    Some(filename)
}

/// 生成图片缩略图 base64（最大 200px）
fn generate_thumbnail(config_dir: &PathBuf, filename: &str) -> Option<String> {
    let filepath = images_dir(config_dir).join(filename);
    let img = image::open(&filepath).ok()?;

    // 缩放到最大 200px
    let thumbnail = img.thumbnail(200, 200);

    // 编码为 PNG base64
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    thumbnail
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;

    Some(base64::engine::general_purpose::STANDARD.encode(&buf))
}

/// 将 entry 转换为前端展示视图
fn entry_to_view(entry: &ClipboardEntry, config_dir: &PathBuf) -> ClipboardEntryView {
    let image_thumbnail = entry
        .image_filename
        .as_ref()
        .and_then(|f| generate_thumbnail(config_dir, f));

    ClipboardEntryView {
        id: entry.id.clone(),
        content_type: entry.content_type.clone(),
        text: entry.text.clone(),
        file_paths: entry.file_paths.clone(),
        image_thumbnail,
        preview: entry.preview.clone(),
        timestamp: entry.timestamp,
    }
}

/// 启动后台剪贴板监控线程
pub fn start_clipboard_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_text_hash: Option<String> = None;
        let mut last_image_hash: Option<String> = None;
        let mut last_files_hash: Option<String> = None;

        // 初始化：读取当前剪贴板状态作为基准（不记录）
        {
            let state = app.state::<ClipboardHistoryState>();
            let _guard = state.clipboard_lock.lock().unwrap();
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                if let Ok(text) = clipboard.get_text() {
                    if !text.is_empty() {
                        last_text_hash = Some(hash_str(&text));
                    }
                }
                if let Ok(img) = clipboard.get_image() {
                    last_image_hash = Some(hash_bytes(&img.bytes));
                }
            }
            // 检测文件
            #[cfg(target_os = "windows")]
            if let Some(files) = win_clipboard::get_clipboard_files() {
                if !files.is_empty() {
                    let joined: String = files.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>().join("\n");
                    last_files_hash = Some(hash_str(&joined));
                }
            }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

            let state = app.state::<ClipboardHistoryState>();
            let _guard = state.clipboard_lock.lock().unwrap();

            let config_dir = state.config_dir.lock().unwrap().clone();

            // 优先检测文件（Windows CF_HDROP）—— 在创建 arboard 实例之前执行，避免剪贴板句柄冲突
            #[cfg(target_os = "windows")]
            {
                if let Some(files) = win_clipboard::get_clipboard_files() {
                    if !files.is_empty() {
                        let paths: Vec<String> = files.iter().map(|p| p.to_string_lossy().to_string()).collect();
                        let joined = paths.join("\n");
                        let hash = hash_str(&joined);

                        if last_files_hash.as_deref() != Some(&hash) {
                            last_files_hash = Some(hash.clone());
                            last_text_hash = None;

                            let preview = if paths.len() == 1 {
                                paths[0].clone()
                            } else {
                                format!("{} 个文件", paths.len())
                            };

                            let entry = ClipboardEntry {
                                id: nanoid::nanoid!(12),
                                content_type: ClipboardContentType::Files,
                                text: None,
                                file_paths: Some(paths),
                                image_filename: None,
                                preview,
                                timestamp: now_ms(),
                            };

                            add_entry(&app, &config_dir, entry);
                            continue;
                        }
                    }
                }
            }

            let mut clipboard = match arboard::Clipboard::new() {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 检测文本
            if let Ok(text) = clipboard.get_text() {
                if !text.is_empty() {
                    let hash = hash_str(&text);
                    if last_text_hash.as_deref() != Some(&hash) {
                        last_text_hash = Some(hash);

                        let truncated = if text.len() > MAX_TEXT_SIZE {
                            let mut end = MAX_TEXT_SIZE;
                            while !text.is_char_boundary(end) {
                                end -= 1;
                            }
                            text[..end].to_string()
                        } else {
                            text.clone()
                        };

                        let preview: String = text.chars().take(100).collect();

                        let entry = ClipboardEntry {
                            id: nanoid::nanoid!(12),
                            content_type: ClipboardContentType::Text,
                            text: Some(truncated),
                            file_paths: None,
                            image_filename: None,
                            preview,
                            timestamp: now_ms(),
                        };

                        add_entry(&app, &config_dir, entry);
                        continue;
                    }
                }
            }

            // 检测图片
            if let Ok(img) = clipboard.get_image() {
                let hash = hash_bytes(&img.bytes);
                if last_image_hash.as_deref() != Some(&hash) {
                    last_image_hash = Some(hash);

                    let filename = save_image(&config_dir, &img.bytes, img.width, img.height);

                    let entry = ClipboardEntry {
                        id: nanoid::nanoid!(12),
                        content_type: ClipboardContentType::Image,
                        text: None,
                        file_paths: None,
                        image_filename: filename,
                        preview: format!("图片 {}x{}", img.width, img.height),
                        timestamp: now_ms(),
                    };

                    add_entry(&app, &config_dir, entry);
                }
            }
        }
    });
}

/// 添加条目到历史并持久化 + 发送事件
fn add_entry(app: &AppHandle, config_dir: &PathBuf, entry: ClipboardEntry) {
    let state = app.state::<ClipboardHistoryState>();
    let mut entries = state.entries.lock().unwrap();

    // 插入到头部
    entries.insert(0, entry.clone());

    // 超出限制时清理最旧的
    if entries.len() > MAX_ENTRIES {
        let removed = entries.split_off(MAX_ENTRIES);
        // 删除旧图片文件
        for old_entry in &removed {
            if let Some(filename) = &old_entry.image_filename {
                let path = images_dir(config_dir).join(filename);
                let _ = std::fs::remove_file(path);
            }
        }
    }

    // 持久化
    save_history(config_dir, &entries);

    // 发送事件到前端
    let view = entry_to_view(&entry, config_dir);
    let _ = app.emit("clipboard-new-entry", view);
}

// ==================== Tauri Commands ====================

/// 初始化剪贴板历史（加载磁盘数据 + 设置配置目录）
#[tauri::command]
pub fn init_clipboard_history(app: AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?;

    let state = app.state::<ClipboardHistoryState>();

    // 设置配置目录
    {
        let mut dir = state.config_dir.lock().unwrap();
        *dir = config_dir.clone();
    }

    // 加载历史
    let entries = load_history(&config_dir);
    {
        let mut state_entries = state.entries.lock().unwrap();
        *state_entries = entries;
    }

    Ok(())
}

/// 获取所有剪贴板历史记录
#[tauri::command]
pub fn get_clipboard_history(app: AppHandle) -> Result<Vec<ClipboardEntryView>, String> {
    let state = app.state::<ClipboardHistoryState>();
    let entries = state.entries.lock().unwrap();
    let config_dir = state.config_dir.lock().unwrap();

    let views = entries
        .iter()
        .map(|e| entry_to_view(e, &config_dir))
        .collect();

    Ok(views)
}

/// 获取指定图片的完整 base64 数据
#[tauri::command]
pub fn get_clipboard_image(app: AppHandle, id: String) -> Result<String, String> {
    let state = app.state::<ClipboardHistoryState>();
    let entries = state.entries.lock().unwrap();
    let config_dir = state.config_dir.lock().unwrap();

    let entry = entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "未找到记录".to_string())?;

    let filename = entry
        .image_filename
        .as_ref()
        .ok_or_else(|| "该记录不是图片".to_string())?;

    let filepath = images_dir(&config_dir).join(filename);
    let bytes = std::fs::read(&filepath).map_err(|e| format!("读取图片失败: {e}"))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 复制文本到剪贴板
#[tauri::command]
pub fn copy_text_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    let _guard = state.clipboard_lock.lock().unwrap();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    Ok(())
}

/// 从历史记录中复制图片到剪贴板
#[tauri::command]
pub fn copy_image_from_history(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();

    let (config_dir, filename) = {
        let entries = state.entries.lock().unwrap();
        let config_dir = state.config_dir.lock().unwrap();

        let entry = entries
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| "未找到记录".to_string())?;

        let filename = entry
            .image_filename
            .clone()
            .ok_or_else(|| "该记录不是图片".to_string())?;

        (config_dir.clone(), filename)
    };

    let filepath = images_dir(&config_dir).join(&filename);
    let img = image::open(&filepath).map_err(|e| format!("读取图片失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();

    let img_data = arboard::ImageData {
        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        width: w as usize,
        height: h as usize,
    };

    let _guard = state.clipboard_lock.lock().unwrap();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .set_image(img_data)
        .map_err(|e| format!("写入剪贴板失败: {e}"))?;

    Ok(())
}

/// 复制文件列表到剪贴板
#[tauri::command]
pub fn copy_files_to_clipboard(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    let _guard = state.clipboard_lock.lock().unwrap();

    #[cfg(target_os = "windows")]
    {
        let file_paths: Vec<std::path::PathBuf> = paths.iter().map(PathBuf::from).collect();
        win_clipboard::set_clipboard_files(&file_paths)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = paths;
        Err("文件复制仅支持 Windows 平台".to_string())
    }
}

/// 删除单条历史记录
#[tauri::command]
pub fn delete_clipboard_entry(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    let mut entries = state.entries.lock().unwrap();
    let config_dir = state.config_dir.lock().unwrap();

    if let Some(pos) = entries.iter().position(|e| e.id == id) {
        let removed = entries.remove(pos);
        // 删除关联的图片文件
        if let Some(filename) = &removed.image_filename {
            let path = images_dir(&config_dir).join(filename);
            let _ = std::fs::remove_file(path);
        }
        save_history(&config_dir, &entries);
    }

    Ok(())
}

/// 清空所有历史记录
#[tauri::command]
pub fn clear_clipboard_history(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    let mut entries = state.entries.lock().unwrap();
    let config_dir = state.config_dir.lock().unwrap();

    // 删除所有图片文件
    let img_dir = images_dir(&config_dir);
    if img_dir.exists() {
        let _ = std::fs::remove_dir_all(&img_dir);
    }

    entries.clear();
    save_history(&config_dir, &entries);

    Ok(())
}
