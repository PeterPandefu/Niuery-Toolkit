use image::{imageops, Rgba, RgbaImage};

use super::{find_window, CaptureRect};

pub(super) fn fit_window_frame(frame: RgbaImage, width: u32, height: u32) -> RgbaImage {
    if frame.dimensions() == (width, height) {
        return frame;
    }
    let scale = (width as f64 / frame.width().max(1) as f64)
        .min(height as f64 / frame.height().max(1) as f64);
    let fitted_width = ((frame.width() as f64 * scale).round() as u32).clamp(1, width);
    let fitted_height = ((frame.height() as f64 * scale).round() as u32).clamp(1, height);
    let resized = imageops::resize(
        &frame,
        fitted_width,
        fitted_height,
        imageops::FilterType::Triangle,
    );
    let mut canvas = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255]));
    // GDI 帧的 alpha 可能为 0，但 RGB 仍有效；编码器忽略 alpha，不能在此混合成黑色。
    imageops::replace(
        &mut canvas,
        &resized,
        ((width - fitted_width) / 2) as i64,
        ((height - fitted_height) / 2) as i64,
    );
    canvas
}

fn validate_window_state(exists: bool, minimized: bool, same_process: bool) -> Result<(), String> {
    if !exists || !same_process {
        return Err("目标窗口已关闭或失效".to_string());
    }
    if minimized {
        return Err("目标窗口已最小化".to_string());
    }
    Ok(())
}

/// 保留同一窗口实例，refresh 不会像 Window::all 那样每帧枚举所有窗口。
pub(super) struct WindowCapture {
    window: xcap::Window,
    #[cfg(target_os = "windows")]
    process_id: u32,
}

impl WindowCapture {
    pub(super) fn new(id: Option<u32>) -> Result<Self, String> {
        let window = find_window(id)?;
        validate_window_state(true, window.is_minimized(), true)?;
        Ok(Self {
            #[cfg(target_os = "windows")]
            process_id: window.process_id(),
            window,
        })
    }

    pub(super) fn refresh(&mut self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::{
                Foundation::HWND,
                UI::WindowsAndMessaging::{
                    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
                },
            };
            let hwnd = HWND(self.window.id() as usize as *mut std::ffi::c_void);
            let mut process_id = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut process_id));
                validate_window_state(
                    IsWindow(hwnd).as_bool() && IsWindowVisible(hwnd).as_bool(),
                    IsIconic(hwnd).as_bool(),
                    process_id == self.process_id,
                )?;
            }
        }
        self.window
            .refresh()
            .map_err(|error| format!("无法更新目标窗口：{error}"))?;
        validate_window_state(true, self.window.is_minimized(), true)
    }

    pub(super) fn rect(&self) -> CaptureRect {
        CaptureRect {
            x: self.window.x(),
            y: self.window.y(),
            width: self.window.width(),
            height: self.window.height(),
        }
    }

    pub(super) fn capture(&self) -> Result<RgbaImage, String> {
        self.window
            .capture_image()
            .map_err(|error| format!("捕获窗口失败：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    #[test]
    fn resized_window_is_letterboxed_without_stretching() {
        let image = RgbaImage::from_pixel(4, 2, Rgba([255, 0, 0, 255]));
        let frame = super::fit_window_frame(image, 4, 4);
        assert_eq!(frame.dimensions(), (4, 4));
        assert_eq!(*frame.get_pixel(0, 0), Rgba([0, 0, 0, 255]));
        assert_eq!(*frame.get_pixel(0, 1), Rgba([255, 0, 0, 255]));
        assert_eq!(*frame.get_pixel(3, 2), Rgba([255, 0, 0, 255]));
        assert_eq!(*frame.get_pixel(3, 3), Rgba([0, 0, 0, 255]));
    }

    #[test]
    fn portrait_window_is_centered_on_fixed_landscape_canvas() {
        let image = RgbaImage::from_pixel(2, 4, Rgba([0, 255, 0, 255]));
        let frame = super::fit_window_frame(image, 8, 4);
        assert_eq!(*frame.get_pixel(2, 0), Rgba([0, 0, 0, 255]));
        assert_eq!(*frame.get_pixel(3, 0), Rgba([0, 255, 0, 255]));
        assert_eq!(*frame.get_pixel(4, 3), Rgba([0, 255, 0, 255]));
        assert_eq!(*frame.get_pixel(5, 3), Rgba([0, 0, 0, 255]));
    }

    #[test]
    fn unchanged_window_keeps_every_pixel() {
        let image = RgbaImage::from_fn(4, 4, |x, y| Rgba([x as u8, y as u8, 99, 255]));
        assert_eq!(super::fit_window_frame(image.clone(), 4, 4), image);
    }

    #[test]
    fn resized_gdi_frame_preserves_rgb_even_when_alpha_is_zero() {
        let image = RgbaImage::from_pixel(4, 2, Rgba([255, 0, 0, 0]));
        let frame = super::fit_window_frame(image, 4, 4);
        assert_eq!(frame.get_pixel(1, 1).0[..3], [255, 0, 0]);
    }

    #[test]
    fn missing_or_minimized_window_stops_instead_of_capturing_desktop() {
        assert!(super::validate_window_state(false, false, true)
            .unwrap_err()
            .contains("关闭"));
        assert!(super::validate_window_state(true, true, true)
            .unwrap_err()
            .contains("最小化"));
        assert!(super::validate_window_state(true, false, false).is_err());
        assert!(super::validate_window_state(true, false, true).is_ok());
    }
}
