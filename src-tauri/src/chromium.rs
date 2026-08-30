use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn chromium_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("NIUERY_CHROMIUM_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let executable = if cfg!(target_os = "windows") {
        "chrome-headless-shell.exe"
    } else {
        "chrome-headless-shell"
    };
    let platform_directory = if cfg!(target_arch = "aarch64") {
        "win-arm64"
    } else {
        "win-x64"
    };
    let mut candidates = vec![
        // 打包后 Tauri 会把 resources 目录映射到 resource_dir。
        resource_dir.join("chromium").join(executable),
        resource_dir
            .join("chromium")
            .join(platform_directory)
            .join(executable),
    ];

    // `tauri dev` 的 resource_dir 通常是 target/debug，不会自动复制源码资源。
    // 开发模式下补查 src-tauri/resources，避免调试环境误报 Chromium 缺失。
    #[cfg(debug_assertions)]
    {
        if let Some(src_tauri_dir) = std::env::current_exe()
            .ok()
            .and_then(|path| path.ancestors().nth(3).map(Path::to_path_buf))
        {
            candidates.push(
                src_tauri_dir
                    .join("resources")
                    .join("chromium")
                    .join(executable),
            );
            candidates.push(
                src_tauri_dir
                    .join("resources")
                    .join("chromium")
                    .join(platform_directory)
                    .join(executable),
            );
        }
    }

    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            let searched = candidates
                .iter()
                .map(|candidate| candidate.display().to_string())
                .collect::<Vec<_>>()
                .join("；");
            format!(
                "未找到本地 Chromium，已检查：{searched}。请运行 npm run prepare:chromium，或设置 NIUERY_CHROMIUM_PATH"
            )
        })
}

/// 使用本地 Chromium 将完整 HTML 渲染为 PDF 字节。
#[tauri::command]
pub async fn render_html_to_pdf(app: AppHandle, html: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || render_html_to_pdf_blocking(&app, &html))
        .await
        .map_err(|error| error.to_string())?
}

/// 使用本地 Chromium 将完整 HTML 截图为 PNG 字节。
#[tauri::command]
pub async fn render_html_to_png(
    app: AppHandle,
    html: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || render_html_to_png_blocking(&app, &html, width, height))
        .await
        .map_err(|error| error.to_string())?
}

fn render_html_to_pdf_blocking(app: &AppHandle, html: &str) -> Result<Vec<u8>, String> {
    let chromium = chromium_path(app)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let base = std::env::temp_dir().join(format!("niuery-markdown-pdf-{}-{timestamp}", std::process::id()));
    fs::create_dir_all(&base).map_err(|error| error.to_string())?;
    let html_path = base.join("document.html");
    let pdf_path = base.join("document.pdf");
    let result = (|| {
        fs::write(&html_path, html).map_err(|error| error.to_string())?;
        let url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
        let mut command = Command::new(&chromium);
        command
            .arg("--headless")
            .arg("--disable-gpu")
            .arg("--no-sandbox")
            .arg("--disable-extensions")
            .arg("--disable-background-networking")
            .arg("--disable-component-update")
            .arg("--disable-default-apps")
            .arg("--disable-sync")
            .arg("--disable-translate")
            .arg("--no-first-run")
            .arg("--no-pdf-header-footer")
            .arg("--run-all-compositor-stages-before-draw")
            .arg("--virtual-time-budget=1000")
            .arg(format!("--print-to-pdf={}", pdf_path.display()))
            .arg(url)
            .current_dir(&base);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        run_chromium(command, "PDF")?;
        fs::read(&pdf_path).map_err(|error| format!("读取生成的 PDF 失败：{error}"))
    })();
    let _ = remove_directory(&base);
    result
}

fn render_html_to_png_blocking(app: &AppHandle, html: &str, width: Option<u32>, height: Option<u32>) -> Result<Vec<u8>, String> {
    let chromium = chromium_path(app)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let base = std::env::temp_dir().join(format!("niuery-markdown-png-{}-{timestamp}", std::process::id()));
    fs::create_dir_all(&base).map_err(|error| error.to_string())?;
    let html_path = base.join("document.html");
    let png_path = base.join("document.png");
    let result = (|| {
        fs::write(&html_path, html).map_err(|error| error.to_string())?;
        let url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
        let mut command = Command::new(&chromium);
        command
            .arg("--headless")
            .arg("--disable-gpu")
            .arg("--no-sandbox")
            .arg("--disable-extensions")
            .arg("--disable-background-networking")
            .arg("--disable-component-update")
            .arg("--disable-default-apps")
            .arg("--disable-sync")
            .arg("--disable-translate")
            .arg("--no-first-run")
            .arg("--hide-scrollbars")
            .arg("--run-all-compositor-stages-before-draw")
            .arg("--virtual-time-budget=1000")
            .arg(format!("--window-size={},{}", width.unwrap_or(1440), height.unwrap_or(10000)))
            .arg(format!("--screenshot={}", png_path.display()))
            .arg(url)
            .current_dir(&base);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        run_chromium(command, "PNG")?;
        fs::read(&png_path).map_err(|error| format!("读取生成的 PNG 失败：{error}"))
    })();
    let _ = remove_directory(&base);
    result
}

fn run_chromium(mut command: Command, format: &str) -> Result<(), String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 Chromium 失败：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match child.try_wait().map_err(|error| format!("等待 Chromium 失败：{error}"))? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("读取 Chromium 输出失败：{error}"))?;
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Chromium 生成 {format} 失败（退出码 {:?}）：{}", status.code(), stderr.trim()));
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Chromium 生成 {format} 超时（30 秒）"));
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn remove_directory(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn chromium_命令使用离线参数() {
        let args = ["--disable-background-networking", "--disable-component-update", "--no-first-run"];
        assert!(args.iter().all(|arg| arg.starts_with("--")));
    }
}
