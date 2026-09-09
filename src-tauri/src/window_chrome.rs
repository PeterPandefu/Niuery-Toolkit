use tauri::{window::Color, Theme, WebviewWindow};

#[tauri::command]
pub fn set_window_chrome(window: WebviewWindow, background: String, foreground: String, dark: bool) -> Result<(), String> {
    let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    let (red, green, blue) = rgb(&background)?;
    let _ = window.set_background_color(Some(Color(red, green, blue, 255)));
    #[cfg(windows)]
    apply_windows_caption(&window, red, green, blue, &foreground, dark)?;
    let _ = foreground;
    Ok(())
}

#[cfg(windows)]
fn apply_windows_caption(window: &WebviewWindow, red: u8, green: u8, blue: u8, foreground: &str, dark: bool) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};

    const DWMWA_USE_IMMERSIVE_DARK_MODE: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(20);
    const DWMWA_WINDOW_CORNER_PREFERENCE: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(33);
    const DWMWA_BORDER_COLOR: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(34);
    const DWMWA_CAPTION_COLOR: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(35);
    const DWMWA_TEXT_COLOR: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(36);
    const DWMWCP_ROUND: u32 = 2;

    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    let caption = colorref(red, green, blue);
    let (text_red, text_green, text_blue) = rgb(foreground)?;
    let text = colorref(text_red, text_green, text_blue);
    let dark_mode = BOOL(i32::from(dark));
    let corner = DWMWCP_ROUND;

    unsafe {
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, std::ptr::addr_of!(caption).cast(), 4);
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, std::ptr::addr_of!(text).cast(), 4);
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, std::ptr::addr_of!(caption).cast(), 4);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::addr_of!(corner).cast(),
            4,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            std::ptr::addr_of!(dark_mode).cast(),
            4,
        );
    }
    Ok(())
}

fn rgb(hex: &str) -> Result<(u8, u8, u8), String> {
    let value = hex.trim().trim_start_matches('#');
    if value.len() < 6 {
        return Err("窗口颜色无效".into());
    }
    let red = u8::from_str_radix(&value[0..2], 16).map_err(|_| "窗口颜色无效".to_string())?;
    let green = u8::from_str_radix(&value[2..4], 16).map_err(|_| "窗口颜色无效".to_string())?;
    let blue = u8::from_str_radix(&value[4..6], 16).map_err(|_| "窗口颜色无效".to_string())?;
    Ok((red, green, blue))
}

#[cfg(windows)]
fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16)
}
