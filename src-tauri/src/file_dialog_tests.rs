use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use crate::file_saver;

// 保留生产命令及其 Tauri 宏，只替换需要人工操作的原生对话框边界。
pub(crate) mod dialog_stub {
    use super::*;

    pub struct PendingDialog {
        pub entered: mpsc::Sender<std::thread::ThreadId>,
        pub release: mpsc::Receiver<()>,
        pub paths: Vec<PathBuf>,
    }

    pub static PENDING: Mutex<Option<PendingDialog>> = Mutex::new(None);

    pub struct FileDialog;

    impl FileDialog {
        pub fn new() -> Self {
            Self
        }

        pub fn add_filter(self, _: &str, _: &[&str]) -> Self {
            self
        }

        pub fn set_file_name(self, _: &str) -> Self {
            self
        }

        pub fn pick_file(self) -> Option<PathBuf> {
            self.pick_files()
                .and_then(|paths| paths.into_iter().next())
        }

        pub fn pick_files(self) -> Option<Vec<PathBuf>> {
            let pending = PENDING.lock().unwrap().take().expect("缺少对话框测试配置");
            pending.entered.send(std::thread::current().id()).unwrap();
            // 超时保证旧实现即便阻塞命令分发，测试仍能自行结束并报告失败。
            let _ = pending.release.recv_timeout(Duration::from_millis(800));
            if pending.paths.is_empty() {
                None
            } else {
                Some(pending.paths)
            }
        }

        pub fn pick_folder(self) -> Option<PathBuf> {
            self.pick_file()
        }

        pub fn save_file(self) -> Option<PathBuf> {
            self.pick_file()
        }
    }
}

#[tauri::command]
fn dialog_heartbeat() -> &'static str {
    "事件仍可响应"
}

#[test]
fn waiting_for_a_file_dialog_does_not_block_ipc_dispatch() {
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![
            file_saver::open_text_file_dialog,
            file_saver::open_text_files_dialog,
            file_saver::open_binary_file_dialog,
            file_saver::pick_existing_file,
            file_saver::pick_existing_folder,
            file_saver::save_file_dialog,
            dialog_heartbeat,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    for command in [
        "open_text_file_dialog",
        "open_text_files_dialog",
        "open_binary_file_dialog",
        "pick_existing_file",
        "pick_existing_folder",
        "save_file_dialog",
    ] {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        *dialog_stub::PENDING.lock().unwrap() = Some(dialog_stub::PendingDialog {
            entered: entered_tx,
            release: release_rx,
            paths: Vec::new(),
        });
        let (response_tx, response_rx) = mpsc::channel();
        let started = std::time::Instant::now();
        window.as_ref().clone().on_message(
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "filterName": "测试文档", "extensions": ["md"],
                    "bytes": [], "defaultName": "测试.md",
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
            Box::new(move |_, _, response, _, _| {
                response_tx.send(response).unwrap();
            }),
        );
        let dispatch_duration = started.elapsed();
        let dialog_thread = entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("命令未打开对话框");
        let still_waiting = response_rx.try_recv().is_err();
        let heartbeat = tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "dialog_heartbeat".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: Default::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        let _ = release_tx.send(());
        assert!(
            dispatch_duration < Duration::from_millis(400),
            "{command} 在对话框等待时阻塞事件分发，耗时 {dispatch_duration:?}"
        );
        assert!(still_waiting, "对话框关闭前不应返回选择结果");
        assert_ne!(
            dialog_thread,
            std::thread::current().id(),
            "原生对话框不应运行在事件分发线程"
        );
        assert_eq!(
            heartbeat.unwrap().deserialize::<String>().unwrap(),
            "事件仍可响应"
        );
        match response_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("关闭对话框后命令未完成")
        {
            tauri::ipc::InvokeResponse::Ok(body) => {
                let cancelled = if command == "open_text_files_dialog" {
                    serde_json::json!({ "files": [], "failures": [] })
                } else {
                    serde_json::Value::Null
                };
                assert_eq!(body.deserialize::<serde_json::Value>().unwrap(), cancelled);
            }
            tauri::ipc::InvokeResponse::Err(error) => panic!("取消选择不应报错: {error:?}"),
        }
    }

    // 单线程运行时下直接轮询生产命令，避免仅改成 async 却继续阻塞工作线程。
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let fixture = std::env::temp_dir().join(format!("文件对话框回归-{}.md", nanoid::nanoid!()));
    std::fs::write(&fixture, "# 导入内容\n").unwrap();
    let second_fixture =
        std::env::temp_dir().join(format!("文件对话框回归-{}.mmd", nanoid::nanoid!()));
    std::fs::write(&second_fixture, "flowchart TD\nA --> B\n").unwrap();
    let missing = fixture.with_extension("不存在");
    runtime.block_on(async {
        for mode in [
            "text",
            "binary",
            "multi",
            "multi-missing",
            "path",
            "folder",
            "save",
            "missing",
        ] {
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            *dialog_stub::PENDING.lock().unwrap() = Some(dialog_stub::PendingDialog {
                entered: entered_tx,
                release: release_rx,
                paths: match mode {
                    "multi" => vec![fixture.clone(), second_fixture.clone()],
                    "multi-missing" => vec![fixture.clone(), missing.clone()],
                    "missing" => vec![missing.clone()],
                    _ => vec![fixture.clone()],
                },
            });
            let runtime_thread = std::thread::current().id();
            let release = async {
                tokio::task::yield_now().await;
                // 只有命令真正让出执行权，当前运行时才能发送关闭信号。
                let _ = release_tx.send(());
            };
            let operation = async {
                let path = fixture.to_string_lossy();
                match mode {
                    "text" => {
                        let file =
                            file_saver::open_text_file_dialog("Markdown".into(), vec!["md".into()])
                                .await
                                .unwrap()
                                .unwrap();
                        assert_eq!(file.path, path);
                        assert_eq!(file.contents, "# 导入内容\n");
                    }
                    "binary" => {
                        use base64::Engine;
                        let file =
                            file_saver::open_binary_file_dialog("文档".into(), vec!["md".into()])
                                .await
                                .unwrap()
                                .unwrap();
                        assert_eq!(file.path, path);
                        assert_eq!(
                            base64::engine::general_purpose::STANDARD
                                .decode(file.contents)
                                .unwrap(),
                            "# 导入内容\n".as_bytes()
                        );
                    }
                    "multi" => {
                        let selection = file_saver::open_text_files_dialog(
                            "图表源文件".into(),
                            vec!["md".into(), "mmd".into()],
                        )
                        .await
                        .unwrap();
                        assert!(selection.failures.is_empty());
                        assert_eq!(selection.files.len(), 2);
                        assert_eq!(selection.files[0].path, path);
                        assert_eq!(selection.files[0].contents, "# 导入内容\n");
                        assert_eq!(
                            selection.files[1].path,
                            second_fixture.to_string_lossy()
                        );
                        assert_eq!(selection.files[1].contents, "flowchart TD\nA --> B\n");
                    }
                    "multi-missing" => {
                        let selection =
                            file_saver::open_text_files_dialog("文档".into(), vec!["md".into()])
                                .await
                                .unwrap();
                        assert_eq!(selection.files.len(), 1);
                        assert_eq!(selection.files[0].path, path);
                        assert_eq!(selection.failures.len(), 1);
                        assert_eq!(selection.failures[0].path, missing.to_string_lossy());
                        assert!(selection.failures[0].error.starts_with("读取文档失败:"));
                    }
                    "path" => assert_eq!(
                        file_saver::pick_existing_file().await.unwrap().as_deref(),
                        Some(path.as_ref())
                    ),
                    "folder" => assert_eq!(
                        file_saver::pick_existing_folder().await.unwrap().as_deref(),
                        Some(path.as_ref())
                    ),
                    "save" => {
                        let saved = file_saver::save_file_dialog(
                            vec![0, 128, 255],
                            "测试.md".into(),
                            "文档".into(),
                            vec!["md".into()],
                        )
                        .await
                        .unwrap();
                        assert_eq!(saved.as_deref(), Some(path.as_ref()));
                        assert_eq!(std::fs::read(&fixture).unwrap(), [0, 128, 255]);
                    }
                    "missing" => assert!(file_saver::open_text_file_dialog(
                        "文档".into(),
                        vec!["md".into()]
                    )
                    .await
                    .err()
                    .expect("读取不存在的文件应返回错误")
                    .starts_with("读取文档失败:")),
                    _ => unreachable!(),
                }
            };
            let started = std::time::Instant::now();
            tokio::join!(operation, release);
            assert!(
                started.elapsed() < Duration::from_millis(400),
                "等待文件选择时阻塞了异步工作线程"
            );
            assert_ne!(
                entered_rx.recv().unwrap(),
                runtime_thread,
                "阻塞操作必须离开异步工作线程"
            );
        }
    });
    std::fs::remove_file(fixture).unwrap();
    std::fs::remove_file(second_fixture).unwrap();
}
