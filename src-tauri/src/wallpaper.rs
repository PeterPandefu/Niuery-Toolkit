//! 壁纸库：在线检索、AI 生成（去水印）、本地保存与设为系统桌面背景。

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub const WATERMARK_BOTTOM_FRACTION: f32 = 0.05;
pub const MAX_WALLPAPER_BYTES: usize = 25 * 1024 * 1024;
pub const JPEG_QUALITY: u8 = 90;
const LIBRARY_FILE: &str = "library.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWallpaper {
    pub id: String,
    pub path: String,
    pub title: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
    pub created_at: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperLibrary {
    pub items: Vec<LocalWallpaper>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OnlineWallpaper {
    pub id: String,
    pub title: String,
    pub thumb_url: String,
    pub full_url: String,
    pub source: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
struct BingArchive {
    images: Vec<BingImage>,
}

#[derive(Deserialize)]
struct BingImage {
    url: String,
    urlbase: String,
    copyright: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize)]
struct WallhavenSearch {
    data: Vec<WallhavenItem>,
}

#[derive(Deserialize)]
struct WallhavenItem {
    id: String,
    path: String,
    dimension_x: u32,
    dimension_y: u32,
    thumbs: WallhavenThumbs,
}

#[derive(Deserialize)]
struct WallhavenThumbs {
    large: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn wallpaper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| format!("创建壁纸目录失败: {e}"))?;
    Ok(dir)
}

fn library_path(dir: &Path) -> PathBuf {
    dir.join(LIBRARY_FILE)
}

pub fn load_library(dir: &Path) -> WallpaperLibrary {
    let path = library_path(dir);
    let Ok(text) = fs::read_to_string(path) else {
        return WallpaperLibrary::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save_library(dir: &Path, library: &WallpaperLibrary) -> Result<(), String> {
    let text = serde_json::to_string_pretty(library).map_err(|e| format!("序列化壁纸库失败: {e}"))?;
    fs::write(library_path(dir), text).map_err(|e| format!("写入壁纸库失败: {e}"))
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed: String = cleaned
        .trim_matches('_')
        .chars()
        .take(60)
        .collect();
    if trimmed.is_empty() {
        "wallpaper".into()
    } else {
        trimmed
    }
}

pub fn encode_path_segment(input: &str) -> String {
    let mut out = String::new();
    for b in input.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn bing_archive_url(page: u32) -> String {
    let idx = page.saturating_sub(1) * 8;
    format!("https://www.bing.com/HPImageArchive.aspx?format=js&idx={idx}&n=8&mkt=zh-CN")
}

pub fn wallhaven_search_url(query: &str, page: u32) -> String {
    let page = page.max(1);
    let q = query.trim();
    if q.is_empty() {
        format!(
            "https://wallhaven.cc/api/v1/search?atleast=1920x1080&sorting=toplist&purity=100&categories=111&page={page}"
        )
    } else {
        format!(
            "https://wallhaven.cc/api/v1/search?q={}&atleast=1920x1080&sorting=relevance&purity=100&categories=111&page={page}",
            encode_path_segment(q)
        )
    }
}

pub fn with_no_watermark_prompt(prompt: &str) -> String {
    let trimmed = prompt.trim();
    format!("{trimmed}, wallpaper, no watermark, no logo, no text overlay, no signature")
}

pub fn build_ai_image_url(prompt: &str, width: u32, height: u32, model: &str, seed: u32) -> String {
    let encoded = encode_path_segment(&with_no_watermark_prompt(prompt));
    let model = sanitize_ai_model(model);
    let width = width.clamp(640, 3840);
    let height = height.clamp(640, 3840);
    format!(
        "https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&model={model}&nologo=true&private=true&enhance=true&safe=true&seed={seed}"
    )
}

pub fn sanitize_ai_model(model: &str) -> &'static str {
    match model {
        "flux-realism" => "flux-realism",
        "flux-anime" => "flux-anime",
        "turbo" => "turbo",
        _ => "flux",
    }
}

pub fn watermark_crop_rect(width: u32, height: u32) -> (u32, u32, u32, u32) {
    let crop_h = ((height as f32) * (1.0 - WATERMARK_BOTTOM_FRACTION)).round() as u32;
    let crop_h = crop_h.max(1).min(height);
    (0, 0, width.max(1), crop_h)
}

pub fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, quality)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG 编码失败: {e}"))?;
    Ok(buf)
}

/// 裁掉底部条带水印并缩放回原尺寸，始终输出 JPEG。
pub fn strip_ai_watermark(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("图片解码失败: {e}"))?;
    let origin_w = img.width();
    let origin_h = img.height();
    let (x, y, w, h) = watermark_crop_rect(origin_w, origin_h);
    let restored = if w == origin_w && h == origin_h {
        img
    } else {
        img.crop_imm(x, y, w, h)
            .resize_exact(origin_w, origin_h, image::imageops::FilterType::Lanczos3)
    };
    encode_jpeg(&restored, JPEG_QUALITY)
}

pub fn parse_bing_archive(json: &str) -> Result<Vec<OnlineWallpaper>, String> {
    let archive: BingArchive =
        serde_json::from_str(json).map_err(|e| format!("解析必应壁纸失败: {e}"))?;
    Ok(archive
        .images
        .into_iter()
        .map(|img| {
            let title = img
                .title
                .filter(|t| !t.trim().is_empty())
                .or(img.copyright.clone())
                .unwrap_or_else(|| "Bing 壁纸".into());
            let id = img
                .urlbase
                .rsplit('/')
                .next()
                .unwrap_or("bing")
                .replace("th?id=", "");
            OnlineWallpaper {
                id,
                title,
                thumb_url: format!("https://www.bing.com{}", img.url),
                full_url: format!("https://www.bing.com{}_UHD.jpg", img.urlbase),
                source: "bing".into(),
                width: 3840,
                height: 2160,
            }
        })
        .collect())
}

pub fn parse_wallhaven_search(json: &str) -> Result<Vec<OnlineWallpaper>, String> {
    let search: WallhavenSearch =
        serde_json::from_str(json).map_err(|e| format!("解析 Wallhaven 失败: {e}"))?;
    Ok(search
        .data
        .into_iter()
        .map(|item| OnlineWallpaper {
            id: item.id.clone(),
            title: format!("Wallhaven {}", item.id),
            thumb_url: item.thumbs.large,
            full_url: item.path,
            source: "wallhaven".into(),
            width: item.dimension_x,
            height: item.dimension_y,
        })
        .collect())
}

fn http_agent(timeout_secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
}

pub fn download_bytes(url: &str, timeout_secs: u64) -> Result<Vec<u8>, String> {
    let resp = http_agent(timeout_secs)
        .get(url)
        .call()
        .map_err(|e| format!("下载失败: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_WALLPAPER_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取失败: {e}"))?;
    if bytes.len() > MAX_WALLPAPER_BYTES {
        return Err("壁纸文件过大（超过 25MB）".into());
    }
    if bytes.is_empty() {
        return Err("下载内容为空".into());
    }
    Ok(bytes)
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("图片解码失败: {e}"))?;
    Ok((img.width(), img.height()))
}

fn persist_jpeg(
    dir: &Path,
    library: &mut WallpaperLibrary,
    jpeg: Vec<u8>,
    title: &str,
    source: &str,
    prompt: Option<String>,
    remote_id: Option<String>,
) -> Result<LocalWallpaper, String> {
    if let Some(remote_id) = remote_id.as_ref() {
        if let Some(existing) = library
            .items
            .iter()
            .find(|item| item.remote_id.as_deref() == Some(remote_id))
        {
            return Ok(existing.clone());
        }
    }

    let (width, height) = image_dimensions(&jpeg)?;
    let id = nanoid::nanoid!(10);
    let filename = format!(
        "{}_{}.jpg",
        sanitize_filename(title),
        &id
    );
    let path = dir.join(&filename);
    fs::write(&path, &jpeg).map_err(|e| format!("保存壁纸失败: {e}"))?;
    let item = LocalWallpaper {
        id,
        path: path.to_string_lossy().into_owned(),
        title: title.trim().chars().take(80).collect(),
        source: source.into(),
        prompt,
        remote_id,
        created_at: now_secs(),
        width,
        height,
    };
    library.items.insert(0, item.clone());
    save_library(dir, library)?;
    Ok(item)
}

fn jpeg_from_bytes(bytes: &[u8], strip_watermark: bool) -> Result<Vec<u8>, String> {
    if strip_watermark {
        return strip_ai_watermark(bytes);
    }
    let img = image::load_from_memory(bytes).map_err(|e| format!("图片解码失败: {e}"))?;
    encode_jpeg(&img, JPEG_QUALITY)
}

#[cfg(windows)]
fn apply_windows_wallpaper(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE,
    };

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_mut_ptr().cast()),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| format!("设置桌面壁纸失败: {e}"))
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_wallpaper(path: &Path) -> Result<(), String> {
    use std::process::Command;
    let posix = path.to_string_lossy().replace('"', "");
    let status = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application \"System Events\" to tell every desktop to set picture to POSIX file \"{posix}\""
        ))
        .status()
        .map_err(|e| format!("设置桌面壁纸失败: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("设置桌面壁纸失败".into())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn apply_linux_wallpaper(path: &Path) -> Result<(), String> {
    use std::process::Command;
    let uri = format!("file://{}", path.to_string_lossy());
    let dark = Command::new("gsettings")
        .args([
            "set",
            "org.gnome.desktop.background",
            "picture-uri-dark",
            &uri,
        ])
        .status();
    let light = Command::new("gsettings")
        .args(["set", "org.gnome.desktop.background", "picture-uri", &uri])
        .status()
        .map_err(|e| format!("设置桌面壁纸失败: {e}"))?;
    let _ = dark;
    if light.success() {
        Ok(())
    } else {
        Err("设置桌面壁纸失败（需要 GNOME gsettings）".into())
    }
}

pub fn apply_desktop_wallpaper(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("壁纸文件不存在".into());
    }
    #[cfg(windows)]
    {
        return apply_windows_wallpaper(path);
    }
    #[cfg(target_os = "macos")]
    {
        return apply_macos_wallpaper(path);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return apply_linux_wallpaper(path);
    }
    #[allow(unreachable_code)]
    Err("当前平台暂不支持设置系统壁纸".into())
}

fn fetch_json(url: &str) -> Result<String, String> {
    http_agent(20)
        .get(url)
        .call()
        .map_err(|e| format!("请求失败: {e}"))?
        .into_string()
        .map_err(|e| format!("读取响应失败: {e}"))
}

#[tauri::command]
pub fn search_online_wallpapers(
    source: String,
    query: String,
    page: u32,
) -> Result<Vec<OnlineWallpaper>, String> {
    let page = page.max(1);
    match source.as_str() {
        "bing" => {
            let json = fetch_json(&bing_archive_url(page))?;
            parse_bing_archive(&json)
        }
        "wallhaven" => {
            let json = fetch_json(&wallhaven_search_url(&query, page))?;
            parse_wallhaven_search(&json)
        }
        _ => Err("未知壁纸来源".into()),
    }
}

#[tauri::command]
pub fn download_online_wallpaper(
    app: AppHandle,
    url: String,
    title: String,
    source: String,
    remote_id: String,
) -> Result<LocalWallpaper, String> {
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    if let Some(existing) = library
        .items
        .iter()
        .find(|item| item.remote_id.as_deref() == Some(remote_id.as_str()))
    {
        return Ok(existing.clone());
    }
    let bytes = download_bytes(&url, 45)?;
    let jpeg = jpeg_from_bytes(&bytes, false)?;
    persist_jpeg(
        &dir,
        &mut library,
        jpeg,
        &title,
        &source,
        None,
        Some(remote_id),
    )
}

#[tauri::command]
pub fn generate_ai_wallpaper(
    app: AppHandle,
    prompt: String,
    width: u32,
    height: u32,
    model: String,
    seed: u32,
) -> Result<LocalWallpaper, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("请输入壁纸描述".into());
    }
    if prompt.chars().count() > 500 {
        return Err("描述过长，请控制在 500 字以内".into());
    }
    let url = build_ai_image_url(&prompt, width, height, &model, seed);
    let bytes = download_bytes(&url, 90)?;
    let jpeg = jpeg_from_bytes(&bytes, true)?;
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    let title = prompt.chars().take(32).collect::<String>();
    persist_jpeg(
        &dir,
        &mut library,
        jpeg,
        &title,
        "ai",
        Some(prompt),
        None,
    )
}

#[tauri::command]
pub fn import_wallpaper(
    app: AppHandle,
    bytes: Vec<u8>,
    title: String,
) -> Result<LocalWallpaper, String> {
    if bytes.is_empty() {
        return Err("文件为空".into());
    }
    if bytes.len() > MAX_WALLPAPER_BYTES {
        return Err("壁纸文件过大（超过 25MB）".into());
    }
    let jpeg = jpeg_from_bytes(&bytes, false)?;
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    persist_jpeg(&dir, &mut library, jpeg, &title, "import", None, None)
}

#[tauri::command]
pub fn list_local_wallpapers(app: AppHandle) -> Result<WallpaperLibrary, String> {
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    library.items.retain(|item| Path::new(&item.path).is_file());
    save_library(&dir, &library)?;
    Ok(library)
}

#[tauri::command]
pub fn delete_local_wallpaper(app: AppHandle, id: String) -> Result<WallpaperLibrary, String> {
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    if let Some(index) = library.items.iter().position(|item| item.id == id) {
        let item = library.items.remove(index);
        let _ = fs::remove_file(&item.path);
        if library.current_id.as_deref() == Some(id.as_str()) {
            library.current_id = None;
        }
        save_library(&dir, &library)?;
    }
    Ok(library)
}

#[tauri::command]
pub fn set_desktop_wallpaper(app: AppHandle, id: String) -> Result<WallpaperLibrary, String> {
    let dir = wallpaper_dir(&app)?;
    let mut library = load_library(&dir);
    let item = library
        .items
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| "壁纸不存在".to_string())?;
    apply_desktop_wallpaper(Path::new(&item.path))?;
    library.current_id = Some(id);
    save_library(&dir, &library)?;
    Ok(library)
}

#[tauri::command]
pub fn reveal_wallpaper_folder(app: AppHandle) -> Result<(), String> {
    let dir = wallpaper_dir(&app)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("无法打开壁纸目录: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("无法打开壁纸目录: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("无法打开壁纸目录: {e}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("当前平台暂不支持打开目录".into())
}
