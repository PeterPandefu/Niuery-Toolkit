//! Windows 原生 rfd 对话框集成测试。
//!
//! 该测试会真实打开系统文件选择框，再通过 Win32 消息自动取消，
//! 不读取或修改用户文件，也不需要人工点击。运行方式：
//! `cargo test --manifest-path src-tauri/Cargo.toml --test windows_rfd_dialog -- --ignored --nocapture`

#![cfg(windows)]

use std::sync::mpsc;
use std::time::{Duration, Instant};

use rfd::FileDialog;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_COMMAND,
};

struct WindowSearch {
    process_id: u32,
    found: Option<HWND>,
}

fn find_dialog(process_id: u32) -> Option<HWND> {
    unsafe extern "system" fn callback(window: HWND, context: LPARAM) -> BOOL {
        // EnumWindows 同步调用此回调，search 在整个枚举期间保持有效。
        let search = &mut *(context.0 as *mut WindowSearch);
        let mut process_id = 0;
        GetWindowThreadProcessId(window, Some(&mut process_id));
        let mut class_name = [0_u16; 64];
        let length = GetClassNameW(window, &mut class_name) as usize;
        if process_id == search.process_id
            && IsWindowVisible(window).as_bool()
            && String::from_utf16_lossy(&class_name[..length]) == "#32770"
        {
            search.found = Some(window);
            return BOOL(0);
        }
        BOOL(1)
    }

    let mut search = WindowSearch {
        process_id,
        found: None,
    };
    unsafe {
        let result = EnumWindows(
            Some(callback),
            LPARAM((&mut search as *mut WindowSearch) as isize),
        );
        // 找到窗口后主动停止枚举也会返回错误，只有未找到时才报告枚举错误。
        if search.found.is_none() {
            result.expect("枚举当前测试进程的窗口失败");
        }
    }
    search.found
}

#[test]
#[ignore = "需要 Windows 交互桌面；测试会自动打开并取消系统对话框"]
fn opens_and_cancels_a_real_windows_rfd_dialog() {
    let (result_tx, result_rx) = mpsc::channel();
    let dialog_thread = std::thread::spawn(move || {
        let selected = FileDialog::new()
            .set_title("原生文件对话框自动回归验证")
            .add_filter("Markdown 文档", &["md"])
            .pick_file();
        let _ = result_tx.send(selected);
    });
    let process_id = std::process::id();
    let deadline = Instant::now() + Duration::from_secs(10);
    let dialog = loop {
        if let Some(window) = find_dialog(process_id) {
            break window;
        }
        assert!(
            Instant::now() < deadline,
            "原生 rfd 文件对话框未在 10 秒内显示"
        );
        std::thread::sleep(Duration::from_millis(20));
    };

    unsafe {
        PostMessageW(dialog, WM_COMMAND, WPARAM(2), LPARAM(0)).expect("取消文件对话框失败");
    }
    assert!(
        result_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("取消后 rfd 对话框未在 5 秒内返回，或对话框线程已崩溃")
            .is_none(),
        "取消文件对话框后不应返回文件路径"
    );
    dialog_thread.join().expect("rfd 对话框线程崩溃");
}
