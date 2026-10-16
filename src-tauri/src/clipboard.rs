use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
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

            if paths.is_empty() {
                None
            } else {
                Some(paths)
            }
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
    /// 本进程刚写入剪贴板。下一次监控只更新基准，避免把这次复制再记成一条新记录。
    ignore_own_write: Mutex<bool>,
    /// 图片文件内容哈希，避免重复复制时反复读取大图。
    image_hashes: Mutex<HashMap<String, String>>,
}

impl Default for ClipboardHistoryState {
    fn default() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            config_dir: Mutex::new(PathBuf::from(".")),
            clipboard_lock: Mutex::new(()),
            ignore_own_write: Mutex::new(false),
            image_hashes: Mutex::new(HashMap::new()),
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
    let _ = std::fs::write(
        &path,
        serde_json::to_string_pretty(entries).unwrap_or_default(),
    );
}

/// 保存图片到磁盘，返回文件名
fn save_image(
    config_dir: &PathBuf,
    rgba_data: &[u8],
    width: usize,
    height: usize,
) -> Option<String> {
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

/// 将 entry 转换为前端展示视图。
///
/// 历史列表首次打开只需要元数据，缩略图通过独立命令按需加载，避免在
/// Tauri 命令线程中同步读取并解码所有历史图片。
fn entry_to_view(entry: &ClipboardEntry) -> ClipboardEntryView {
    ClipboardEntryView {
        id: entry.id.clone(),
        content_type: entry.content_type.clone(),
        text: entry.text.clone(),
        file_paths: entry.file_paths.clone(),
        image_thumbnail: None,
        preview: entry.preview.clone(),
        timestamp: entry.timestamp,
    }
}

/// 将新条目转换为事件视图。新产生的条目只有一张图片，生成缩略图不会
/// 阻塞历史列表的首次加载；保留它可以让已打开的列表立即显示新图片。
fn entry_to_event_view(entry: &ClipboardEntry, config_dir: &PathBuf) -> ClipboardEntryView {
    let mut view = entry_to_view(entry);
    view.image_thumbnail = entry
        .image_filename
        .as_ref()
        .and_then(|filename| generate_thumbnail(config_dir, filename));
    view
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
                    let joined: String = files
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join("\n");
                    last_files_hash = Some(hash_str(&joined));
                }
            }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

            let state = app.state::<ClipboardHistoryState>();
            let _guard = state.clipboard_lock.lock().unwrap();
            let ignore_own_write = {
                let mut flag = state.ignore_own_write.lock().unwrap();
                std::mem::take(&mut *flag)
            };

            let config_dir = state.config_dir.lock().unwrap().clone();

            // 优先检测文件（Windows CF_HDROP）—— 在创建 arboard 实例之前执行，避免剪贴板句柄冲突
            #[cfg(target_os = "windows")]
            {
                if let Some(files) = win_clipboard::get_clipboard_files() {
                    if !files.is_empty() {
                        let paths: Vec<String> = files
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        let joined = paths.join("\n");
                        let hash = hash_str(&joined);

                        if last_files_hash.as_deref() != Some(&hash) {
                            last_files_hash = Some(hash);
                            last_text_hash = None;
                            if ignore_own_write {
                                continue;
                            }

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
                        if ignore_own_write {
                            continue;
                        }

                        let truncated = truncate_clipboard_text(&text);
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
                    if ignore_own_write {
                        continue;
                    }

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

/// 将应用启动前已经存在于系统剪贴板中的图片写入历史。
/// 监控线程会把它作为基准而不记录，因此需在启动监控前单独采集一次。
pub fn record_startup_clipboard_image(app: &AppHandle) {
    let state = app.state::<ClipboardHistoryState>();
    let _guard = match state.clipboard_lock.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let config_dir = state.config_dir.lock().unwrap().clone();
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(_) => return,
    };
    let img = match clipboard.get_image() {
        Ok(img) => img,
        Err(_) => return,
    };
    drop(_guard);

    let filename = save_image(&config_dir, &img.bytes, img.width, img.height);
    if filename.is_none() {
        return;
    }
    let entry = ClipboardEntry {
        id: nanoid::nanoid!(12),
        content_type: ClipboardContentType::Image,
        text: None,
        file_paths: None,
        image_filename: filename,
        preview: format!("图片 {}x{}", img.width, img.height),
        timestamp: now_ms(),
    };
    add_entry(app, &config_dir, entry);
}

fn truncate_clipboard_text(text: &str) -> String {
    if text.len() <= MAX_TEXT_SIZE {
        return text.to_string();
    }
    let mut end = MAX_TEXT_SIZE;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn mark_own_write(state: &ClipboardHistoryState) {
    *state.ignore_own_write.lock().unwrap() = true;
}

fn cached_image_hash(
    config_dir: &PathBuf,
    cache: &mut HashMap<String, String>,
    filename: &str,
) -> Option<String> {
    if let Some(hash) = cache.get(filename) {
        return Some(hash.clone());
    }
    let bytes = std::fs::read(images_dir(config_dir).join(filename)).ok()?;
    let hash = hash_bytes(&bytes);
    cache.insert(filename.to_string(), hash.clone());
    Some(hash)
}

fn images_match(
    config_dir: &PathBuf,
    cache: &mut HashMap<String, String>,
    left: Option<&str>,
    right: Option<&str>,
) -> bool {
    let (Some(left), Some(right)) = (left, right) else {
        return false;
    };
    if left == right {
        return true;
    }
    let dir = images_dir(config_dir);
    let left_len = std::fs::metadata(dir.join(left))
        .ok()
        .map(|meta| meta.len());
    let right_len = std::fs::metadata(dir.join(right))
        .ok()
        .map(|meta| meta.len());
    if left_len.is_none() || left_len != right_len {
        return false;
    }
    match (
        cached_image_hash(config_dir, cache, left),
        cached_image_hash(config_dir, cache, right),
    ) {
        (Some(left_hash), Some(right_hash)) => left_hash == right_hash,
        _ => false,
    }
}

fn same_recorded_content(
    config_dir: &PathBuf,
    cache: &mut HashMap<String, String>,
    existing: &ClipboardEntry,
    incoming: &ClipboardEntry,
) -> bool {
    if existing.content_type != incoming.content_type {
        return false;
    }
    match existing.content_type {
        ClipboardContentType::Text => existing.text == incoming.text,
        ClipboardContentType::Files => existing.file_paths == incoming.file_paths,
        ClipboardContentType::Image => images_match(
            config_dir,
            cache,
            existing.image_filename.as_deref(),
            incoming.image_filename.as_deref(),
        ),
    }
}

/// 相同内容已存在时，把原记录移到顶部并沿用其 id；否则插入新记录。
/// 返回应通知前端的记录，以及不再需要的重复图片文件名。
fn place_clipboard_entry(
    entries: &mut Vec<ClipboardEntry>,
    config_dir: &PathBuf,
    cache: &mut HashMap<String, String>,
    incoming: ClipboardEntry,
) -> (ClipboardEntry, Option<String>) {
    if let Some(index) = entries
        .iter()
        .position(|existing| same_recorded_content(config_dir, cache, existing, &incoming))
    {
        let mut existing = entries.remove(index);
        let discarded = incoming
            .image_filename
            .filter(|filename| existing.image_filename.as_deref() != Some(filename.as_str()));
        existing.timestamp = incoming.timestamp;
        entries.insert(0, existing.clone());
        return (existing, discarded);
    }

    entries.insert(0, incoming.clone());
    (incoming, None)
}

fn publish_entries(
    app: &AppHandle,
    config_dir: &PathBuf,
    entries: &[ClipboardEntry],
    entry: &ClipboardEntry,
) {
    save_history(config_dir, entries);
    let view = entry_to_event_view(entry, config_dir);
    let _ = app.emit("clipboard-new-entry", view);
}

fn remove_image_file(config_dir: &PathBuf, cache: &mut HashMap<String, String>, filename: &str) {
    let path = images_dir(config_dir).join(filename);
    let _ = std::fs::remove_file(path);
    cache.remove(filename);
}

/// 添加条目到历史并持久化 + 发送事件。内容已存在时只把原记录移到顶部。
fn add_entry(app: &AppHandle, config_dir: &PathBuf, entry: ClipboardEntry) {
    let state = app.state::<ClipboardHistoryState>();
    let mut entries = state.entries.lock().unwrap();
    let mut image_hashes = state.image_hashes.lock().unwrap();

    let (recorded, discarded_image) =
        place_clipboard_entry(&mut entries, config_dir, &mut image_hashes, entry);
    if let Some(filename) = &discarded_image {
        remove_image_file(config_dir, &mut image_hashes, filename);
    }

    if entries.len() > MAX_ENTRIES {
        let removed = entries.split_off(MAX_ENTRIES);
        for old_entry in &removed {
            if let Some(filename) = &old_entry.image_filename {
                remove_image_file(config_dir, &mut image_hashes, filename);
            }
        }
    }

    drop(image_hashes);
    publish_entries(app, config_dir, &entries, &recorded);
}

/// 把指定历史记录移到顶部并刷新时间。找不到时返回 false。
fn promote_entry_by_id(app: &AppHandle, id: &str) -> bool {
    let state = app.state::<ClipboardHistoryState>();
    let mut entries = state.entries.lock().unwrap();
    let Some(index) = entries.iter().position(|entry| entry.id == id) else {
        return false;
    };
    let config_dir = state.config_dir.lock().unwrap().clone();
    let mut entry = entries.remove(index);
    entry.timestamp = now_ms();
    entries.insert(0, entry.clone());
    publish_entries(app, &config_dir, &entries, &entry);
    true
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

    let views = entries.iter().map(entry_to_view).collect();

    Ok(views)
}

/// 获取指定历史图片的缩略图。该命令只在图片进入可视区域时调用，避免
/// 首次打开历史列表时批量解码所有图片。
#[tauri::command]
pub fn get_clipboard_thumbnail(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let state = app.state::<ClipboardHistoryState>();

    let (config_dir, filename) = {
        let entries = state.entries.lock().unwrap();
        let config_dir = state.config_dir.lock().unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| "未找到记录".to_string())?;

        (config_dir.clone(), entry.image_filename.clone())
    };

    Ok(filename.and_then(|filename| generate_thumbnail(&config_dir, &filename)))
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

/// 复制文本到剪贴板。传入历史 id 时把该条移到顶部，不新建记录。
#[tauri::command]
pub fn copy_text_to_clipboard(
    app: AppHandle,
    text: String,
    id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    {
        let _guard = state.clipboard_lock.lock().unwrap();

        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
        clipboard
            .set_text(&text)
            .map_err(|e| format!("写入剪贴板失败: {e}"))?;
        mark_own_write(&state);
    }

    if let Some(id) = id.as_deref() {
        promote_entry_by_id(&app, id);
    }
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
    {
        let _guard = state.clipboard_lock.lock().unwrap();
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
        clipboard
            .set_image(img_data)
            .map_err(|e| format!("写入剪贴板失败: {e}"))?;
        mark_own_write(&state);
    }
    promote_entry_by_id(&app, &id);

    Ok(())
}

/// 复制文件列表到剪贴板。传入历史 id 时把该条移到顶部，不新建记录。
#[tauri::command]
pub fn copy_files_to_clipboard(
    app: AppHandle,
    paths: Vec<String>,
    id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<ClipboardHistoryState>();
    {
        let _guard = state.clipboard_lock.lock().unwrap();

        #[cfg(target_os = "windows")]
        {
            let file_paths: Vec<std::path::PathBuf> = paths.iter().map(PathBuf::from).collect();
            win_clipboard::set_clipboard_files(&file_paths)?;
            mark_own_write(&state);
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = (&app, paths);
            return Err("文件复制仅支持 Windows 平台".to_string());
        }
    }

    if let Some(id) = id.as_deref() {
        promote_entry_by_id(&app, id);
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_view_does_not_decode_image_thumbnail() {
        let config_dir =
            std::env::temp_dir().join(format!("niuery-clipboard-test-{}", nanoid::nanoid!(8)));
        let image_dir = images_dir(&config_dir);
        std::fs::create_dir_all(&image_dir).expect("创建测试图片目录失败");
        let image_path = image_dir.join("image.png");
        image::RgbaImage::from_pixel(32, 32, image::Rgba([0, 128, 255, 255]))
            .save(&image_path)
            .expect("写入测试图片失败");

        let entry = ClipboardEntry {
            id: "test-image".to_string(),
            content_type: ClipboardContentType::Image,
            text: None,
            file_paths: None,
            image_filename: Some("image.png".to_string()),
            preview: "图片 32x32".to_string(),
            timestamp: 0,
        };

        let view = entry_to_view(&entry);
        assert!(view.image_thumbnail.is_none());

        let _ = std::fs::remove_dir_all(config_dir);
    }

    fn text_entry(id: &str, text: &str, timestamp: u64) -> ClipboardEntry {
        ClipboardEntry {
            id: id.to_string(),
            content_type: ClipboardContentType::Text,
            text: Some(text.to_string()),
            file_paths: None,
            image_filename: None,
            preview: text.to_string(),
            timestamp,
        }
    }

    fn files_entry(id: &str, paths: &[&str], timestamp: u64) -> ClipboardEntry {
        ClipboardEntry {
            id: id.to_string(),
            content_type: ClipboardContentType::Files,
            text: None,
            file_paths: Some(paths.iter().map(|path| path.to_string()).collect()),
            image_filename: None,
            preview: paths.join("\n"),
            timestamp,
        }
    }

    #[test]
    fn repeated_text_moves_existing_entry_instead_of_duplicating() {
        let config_dir = PathBuf::from(".");
        let mut cache = HashMap::new();
        let mut entries = vec![
            text_entry("newer", "beta", 20),
            text_entry("older", "alpha", 10),
        ];

        let (placed, discarded) = place_clipboard_entry(
            &mut entries,
            &config_dir,
            &mut cache,
            text_entry("fresh", "alpha", 30),
        );

        assert!(discarded.is_none());
        assert_eq!(entries.len(), 2);
        assert_eq!(placed.id, "older");
        assert_eq!(entries[0].id, "older");
        assert_eq!(entries[0].timestamp, 30);
        assert_eq!(entries[1].id, "newer");
    }

    #[test]
    fn new_text_is_inserted_at_front() {
        let config_dir = PathBuf::from(".");
        let mut cache = HashMap::new();
        let mut entries = vec![text_entry("older", "alpha", 10)];

        let (placed, _) = place_clipboard_entry(
            &mut entries,
            &config_dir,
            &mut cache,
            text_entry("fresh", "gamma", 30),
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(placed.id, "fresh");
        assert_eq!(entries[0].id, "fresh");
    }

    #[test]
    fn repeated_files_move_existing_entry() {
        let config_dir = PathBuf::from(".");
        let mut cache = HashMap::new();
        let mut entries = vec![
            files_entry("newer", &["C:\\other.txt"], 20),
            files_entry("older", &["C:\\a.txt", "C:\\b.txt"], 10),
        ];

        let (placed, _) = place_clipboard_entry(
            &mut entries,
            &config_dir,
            &mut cache,
            files_entry("fresh", &["C:\\a.txt", "C:\\b.txt"], 40),
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(placed.id, "older");
        assert_eq!(entries[0].timestamp, 40);
    }

    #[test]
    fn repeated_image_reuses_existing_record_and_discards_new_file() {
        let config_dir =
            std::env::temp_dir().join(format!("niuery-clipboard-dedup-{}", nanoid::nanoid!(8)));
        let rgba = image::RgbaImage::from_pixel(8, 8, image::Rgba([9, 8, 7, 255])).into_raw();
        let original = save_image(&config_dir, &rgba, 8, 8).expect("保存原图失败");
        let duplicate = save_image(&config_dir, &rgba, 8, 8).expect("保存重复图失败");
        let different = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 1, 1, 255])).into_raw();
        let other = save_image(&config_dir, &different, 8, 8).expect("保存不同图失败");

        let mut cache = HashMap::new();
        let mut entries = vec![ClipboardEntry {
            id: "img-old".to_string(),
            content_type: ClipboardContentType::Image,
            text: None,
            file_paths: None,
            image_filename: Some(original.clone()),
            preview: "图片 8x8".to_string(),
            timestamp: 10,
        }];

        let (placed, discarded) = place_clipboard_entry(
            &mut entries,
            &config_dir,
            &mut cache,
            ClipboardEntry {
                id: "img-new".to_string(),
                content_type: ClipboardContentType::Image,
                text: None,
                file_paths: None,
                image_filename: Some(duplicate.clone()),
                preview: "图片 8x8".to_string(),
                timestamp: 50,
            },
        );

        assert_eq!(placed.id, "img-old");
        assert_eq!(discarded.as_deref(), Some(duplicate.as_str()));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].timestamp, 50);
        assert_eq!(
            entries[0].image_filename.as_deref(),
            Some(original.as_str())
        );

        let (placed, discarded) = place_clipboard_entry(
            &mut entries,
            &config_dir,
            &mut cache,
            ClipboardEntry {
                id: "img-other".to_string(),
                content_type: ClipboardContentType::Image,
                text: None,
                file_paths: None,
                image_filename: Some(other),
                preview: "图片 8x8".to_string(),
                timestamp: 60,
            },
        );
        assert_eq!(placed.id, "img-other");
        assert!(discarded.is_none());
        assert_eq!(entries.len(), 2);

        let _ = std::fs::remove_dir_all(config_dir);
    }
}
