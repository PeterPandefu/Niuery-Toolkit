use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub fn command_output(program: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let root = std::env::temp_dir().join(format!("niuery-probe-{}", nanoid::nanoid!()));
    fs::create_dir(&root).map_err(|e| e.to_string())?;
    let result = (|| {
        let stdout = fs::File::create(root.join("stdout")).map_err(|e| e.to_string())?;
        let stderr = fs::File::create(root.join("stderr")).map_err(|e| e.to_string())?;
        let mut command = Command::new(program);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .current_dir(&root);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                if !status.success() {
                    return Err(format!("Compatibility check failed: {status}"));
                }
                break;
            }
            let output_size: u64 = ["stdout", "stderr"]
                .iter()
                .filter_map(|name| fs::metadata(root.join(name)).ok())
                .map(|m| m.len())
                .sum();
            if start.elapsed() > timeout || output_size > 2 * 1024 * 1024 {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Compatibility check timed out or exceeded output limit".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let mut output = fs::read_to_string(root.join("stdout")).unwrap_or_default();
        output.push_str(&fs::read_to_string(root.join("stderr")).unwrap_or_default());
        Ok(output)
    })();
    let _ = fs::remove_dir_all(root);
    result
}

pub fn validate(id: &str, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("Select an existing absolute file path".into());
    }
    let timeout = Duration::from_secs(15);
    match id {
        "ffmpeg" => {
            let encoders = command_output(path, &["-hide_banner", "-encoders"], timeout)?;
            if !["libx264", "libopenh264", "h264_mf"]
                .iter()
                .any(|e| has_name(&encoders, e))
                || !has_name(&encoders, "aac")
                || !has_name(&encoders, "gif")
            {
                return Err("FFmpeg requires H.264, AAC and GIF encoders".into());
            }
            let filters = command_output(path, &["-hide_banner", "-filters"], timeout)?;
            if !["palettegen", "paletteuse", "scale", "fps", "amix", "split"]
                .iter()
                .all(|f| has_name(&filters, f))
            {
                return Err("FFmpeg is missing recording/GIF filters".into());
            }
            let formats = command_output(path, &["-hide_banner", "-formats"], timeout)?;
            if !["gdigrab", "dshow", "rawvideo", "concat", "mp4", "gif"]
                .iter()
                .all(|f| formats.contains(f))
            {
                return Err("FFmpeg is missing capture/container support".into());
            }
        }
        "java" => {
            let output = command_output(path, &["-version"], timeout)?;
            let version = output
                .split('"')
                .nth(1)
                .and_then(|v| v.split('.').next())
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            if version < 17 {
                return Err("Java 17 or newer is required".into());
            }
        }
        "chromium" => {
            let root =
                std::env::temp_dir().join(format!("niuery-browser-probe-{}", nanoid::nanoid!()));
            fs::create_dir(&root).map_err(|e| e.to_string())?;
            let result: Result<(), String> = (|| {
                fs::write(
                    root.join("probe.html"),
                    "<!doctype html><meta charset=utf-8><p>离线 export check</p>",
                )
                .map_err(|e| e.to_string())?;
                let pdf = format!("--print-to-pdf={}", root.join("probe.pdf").display());
                let png = format!("--screenshot={}", root.join("probe.png").display());
                let profile = format!("--user-data-dir={}", root.join("profile").display());
                let url = format!(
                    "file:///{}",
                    root.join("probe.html").to_string_lossy().replace('\\', "/")
                );
                command_output(
                    path,
                    &[
                        "--headless",
                        "--disable-gpu",
                        "--no-sandbox",
                        "--no-first-run",
                        "--disable-background-networking",
                        "--disable-extensions",
                        "--disable-component-update",
                        "--window-size=160,100",
                        &profile,
                        &pdf,
                        &png,
                        &url,
                    ],
                    timeout,
                )?;
                if !fs::read(root.join("probe.pdf"))
                    .unwrap_or_default()
                    .starts_with(b"%PDF")
                    || !fs::read(root.join("probe.png"))
                        .unwrap_or_default()
                        .starts_with(b"\x89PNG")
                {
                    return Err("Browser did not produce valid PDF and PNG".into());
                }
                Ok(())
            })();
            let _ = fs::remove_dir_all(root);
            result?;
        }
        "plantuml" | "ocr-engine" | "ocr-chi-sim" | "ocr-eng" => {}
        _ => return Err("Unknown resource type".into()),
    }
    Ok(())
}

fn has_name(output: &str, name: &str) -> bool {
    output
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some(name))
}

pub fn system_candidates(id: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(variable) = match id {
        "ffmpeg" => Some("NIUERY_FFMPEG_PATH"),
        "chromium" => Some("NIUERY_CHROMIUM_PATH"),
        "java" => Some("NIUERY_JAVA_PATH"),
        _ => None,
    } {
        if let Some(value) = std::env::var_os(variable) {
            paths.push(PathBuf::from(value));
        }
    }
    if id == "java" {
        if let Some(base) = std::env::var_os("JAVA_HOME") {
            paths.push(PathBuf::from(base).join("bin/java.exe"));
        }
    }
    if id == "chromium" {
        for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(variable) {
                for relative in [
                    "Microsoft/Edge/Application/msedge.exe",
                    "Google/Chrome/Application/chrome.exe",
                ] {
                    paths.push(PathBuf::from(&base).join(relative));
                }
            }
        }
    }
    let executable = match id {
        "ffmpeg" => Some("ffmpeg.exe"),
        "java" => Some("java.exe"),
        "chromium" => Some("chrome-headless-shell.exe"),
        _ => None,
    };
    if let (Some(name), Some(value)) = (executable, std::env::var_os("PATH")) {
        for directory in std::env::split_paths(&value).filter(|p| p.is_absolute()) {
            paths.push(directory.join(name));
        }
    }
    paths
        .into_iter()
        .filter(|p| p.is_absolute() && p.is_file())
        .collect()
}
