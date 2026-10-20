//! Windows 原生文件对话框回归：自动打开并取消，不读取或修改用户文件。
//! 运行：cargo run --example file_dialog_smoke

#[cfg(windows)]
#[allow(dead_code)]
#[path = "../src/file_saver.rs"]
mod file_saver;

#[cfg(windows)]
fn main() {
    use std::sync::mpsc;
    use std::time::Duration;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, PostMessageW, WM_COMMAND,
    };

    unsafe extern "system" fn cancel_own_dialog(window: HWND, context: LPARAM) -> BOOL {
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        let mut class = [0_u16; 64];
        let length = GetClassNameW(window, &mut class) as usize;
        if pid == std::process::id() && String::from_utf16_lossy(&class[..length]) == "#32770" {
            // 仅取消当前验证进程自己的文件对话框。
            if PostMessageW(window, WM_COMMAND, WPARAM(2), LPARAM(0)).is_ok() {
                *(context.0 as *mut bool) = true;
            }
        }
        BOOL(1)
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        for round in 0..3 {
            for mode in ["text", "binary", "path", "folder", "save"] {
                let (shown_tx, shown_rx) = tokio::sync::oneshot::channel();
                let (responsive_tx, responsive_rx) = mpsc::channel();
                let canceller = std::thread::spawn(move || {
                    // 观察到对话框后，先确认运行时仍能响应，再自动取消。
                    let deadline = std::time::Instant::now() + Duration::from_secs(10);
                    loop {
                        let mut found = false;
                        unsafe extern "system" fn find_own_dialog(
                            window: HWND,
                            context: LPARAM,
                        ) -> BOOL {
                            let mut pid = 0;
                            GetWindowThreadProcessId(window, Some(&mut pid));
                            let mut class = [0_u16; 64];
                            let length = GetClassNameW(window, &mut class) as usize;
                            if pid == std::process::id()
                                && String::from_utf16_lossy(&class[..length]) == "#32770"
                            {
                                *(context.0 as *mut bool) = true;
                            }
                            BOOL(1)
                        }
                        unsafe {
                            EnumWindows(
                                Some(find_own_dialog),
                                LPARAM(&mut found as *mut bool as isize),
                            )
                            .unwrap();
                        }
                        if found {
                            break;
                        }
                        if std::time::Instant::now() >= deadline {
                            eprintln!("验证失败：原生文件对话框未在时限内显示");
                            std::process::exit(1);
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    shown_tx.send(()).unwrap();
                    if responsive_rx.recv_timeout(Duration::from_secs(2)).is_err() {
                        eprintln!("验证失败：对话框等待期间运行时无法响应");
                        std::process::exit(1);
                    }
                    let mut cancelled = false;
                    unsafe {
                        EnumWindows(
                            Some(cancel_own_dialog),
                            LPARAM(&mut cancelled as *mut bool as isize),
                        )
                        .unwrap();
                    }
                    assert!(cancelled, "未能取消验证进程的对话框");
                });
                let operation = async {
                    match mode {
                        "text" => assert!(file_saver::open_text_file_dialog(
                            "Markdown".into(),
                            vec!["md".into()]
                        )
                        .await
                        .unwrap()
                        .is_none()),
                        "binary" => assert!(file_saver::open_binary_file_dialog(
                            "文档".into(),
                            vec!["pdf".into()]
                        )
                        .await
                        .unwrap()
                        .is_none()),
                        "path" => {
                            assert!(file_saver::pick_existing_file().await.unwrap().is_none())
                        }
                        "folder" => {
                            assert!(file_saver::pick_existing_folder().await.unwrap().is_none())
                        }
                        "save" => assert!(file_saver::save_file_dialog(
                            vec![],
                            "验证.md".into(),
                            "Markdown".into(),
                            vec!["md".into()]
                        )
                        .await
                        .unwrap()
                        .is_none()),
                        _ => unreachable!(),
                    }
                };
                let heartbeat = async {
                    shown_rx.await.unwrap();
                    responsive_tx.send(()).unwrap();
                };
                tokio::time::timeout(Duration::from_secs(15), async {
                    tokio::join!(operation, heartbeat);
                })
                .await
                .expect("关闭对话框后命令未完成");
                canceller.join().unwrap();
                println!(
                    "第 {} 轮 {mode}：原生对话框显示、等待响应和取消均通过",
                    round + 1
                );
            }
        }
    });
}

#[cfg(not(windows))]
fn main() {
    println!("该验证程序仅适用于 Windows");
}
