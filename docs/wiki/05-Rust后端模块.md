# 05 · Rust 后端模块

> 覆盖 [src-tauri/src/](../../src-tauri/src/) 全部 13 个模块：lib.rs 装配中心 + 12 个领域模块（resources/ 为子目录含 4 个文件）。
> crate：`niuery-toolkit`（lib 名 `niuery_toolkit_lib`，crate-type staticlib/cdylib/rlib，edition 2021）。

## 1. lib.rs — 应用装配中心（607 行）

### 1.1 装配流程（`run()`）

```rust
tauri::Builder::default()
  1) register_asynchronous_uri_scheme_protocol("resource", ...)  // OCR 资产受控分发协议
  2) .plugin(...) × 10     // opener / http / single-instance / global-shortcut /
                            // autostart / dialog / updater / process
  3) .manage(...) × 8       // CaptureGuardState / WsServerState / ScreenshotState /
                            // RecorderState / ClipboardHistoryState / SystemMonitorState /
                            // HotkeyState / CloseBehaviorState
  4) .invoke_handler(generate_handler![...])   // 74 个命令
  5) .setup(...)            // 初始化序列（见 02 章 §5.3）
  6) .on_window_event(...)  // 按 label 分发窗口事件
  7) .build(generate_context!()).run(...)     // RunEvent::Exit → dev_server::kill_spawned()
```

**(1) resource:// 协议**：请求路径交给 `resources::read_ocr_asset(&app, path)`（后台线程），成功返回 `(bytes, mime)` + `Access-Control-Allow-Origin: *` + `X-Content-Type-Options: nosniff`，失败 404。白名单映射，拒绝任意路径。

**(2) 单实例插件**：二次启动时 show + unminimize + set_focus 主窗口。

### 1.2 关键辅助

| 项 | 说明 |
| --- | --- |
| `dev_server` 子模块（debug+windows） | 独立启动（如开机自启）时探测 devUrl(21516) 无人监听 → 等 tauri dev 10s → 后台 `cmd /C npm run dev`（DETACHED+NO_WINDOW）→ 就绪后主窗 navigate；退出时 `taskkill /T /F` 清理 |
| `is_window_shown(visible, minimized)` | 可见 = visible && !minimized |
| `should_show_close_dialog(close_to_exit, dialog_open)` | `close_to_exit.is_none() && !dialog_open` |
| `CloseBehaviorState` | `choice: Mutex<Option<bool>>`（运行期记忆）+ `dialog_open: AtomicBool`；`try_begin_dialog()` CAS 防并发弹窗、`finish_dialog(choice)` |
| `current_capture_activity(app)` | 依次判断 recorder 活动会话 → Longshot（窗口存在）→ Screenshot → Idle |

### 1.3 窗口事件路由（`on_window_event`）

| 窗口 | 事件 | 处理 |
| --- | --- | --- |
| `screenshot` | Destroyed | `screenshot::release_screenshot_session`（窗口真正销毁才解除会话占用，防竞态） |
| `longshot-panel` | Destroyed | `unregister_longshot_esc` + `restore_cursor_for_longshot` |
| `sticky-note` | CloseRequested | prevent_close + hide；Moved → `hide_sticky_note_at_edge`（贴边隐藏） |
| `main` | CloseRequested | 三态：`Some(true)` 退出；`Some(false)` prevent+hide（最小化到托盘）；`None` 原生对话框（退出/最小化到托盘）→ 运行期记忆选择 |

### 1.4 全局快捷键分发（global-shortcut handler 核心）

仅处理 `ShortcutState::Pressed`，按序：

1. **截图会话 Esc**：`is_screenshot_esc` && 会话活跃 → 取当前 generation，**延后一拍**（spawn+sleep 1ms，插件回调内不能同步注销自身）后 `close_screenshot_generation` —— 防透明置顶层拦截桌面输入导致假死；
2. **长截图 Esc**：向 longshot-panel 窗口 emit `longshot-esc`；
3. **录屏 Esc**：`is_recording_esc` && 有活动会话 → spawn `stop_recording`；
4. **用户配置动作**（`hotkey::find_action` 动态反查）：
   - `screenshot` → `capture_guard::decide_shortcut` 判 Start 才 `screenshot::start_screenshot(app, None)`；
   - `longshot` → 判 Start → emit `open-longshot-editor` + `start_screenshot(app, Some("longshot"))`；
   - `showWindow` → 可见则 hide，否则 show/unminimize/set_focus；
   - `stickyNote` → `sticky_note::toggle_sticky_note`；
   - `screenRecorder` → 判 StopRecording 则停止录制；判 Start 则显示主窗 + emit `open-screen-recorder`。

## 2. recorder.rs — 屏幕录制（2843 行，FFmpeg 集成核心）

### 2.1 数据契约（serde camelCase）

`CaptureRect{x,y,width,height}`、`CaptureTarget{mode: monitor|region|window, monitor_id?, window_id?, rect?}`、`RecordingSettings{fps, quality, countdown_sec, cursor_highlight, audio{microphone, system, microphone_id?, system_id?}}`、`MonitorInfo{...,scale_factor,primary}`、`WindowInfo{...}`、`AudioSource{id,name,kind}`、`RecordingSession{id,width,height,started_at}`、`RecordingArtifact{warning?, path, duration_ms, requested_fps, fps, quality, capture_backend("gdigrab"|"xcap"), width, height, size_bytes}`、`ExportResult{path,format,size_bytes,warning?}`、`GifEditArtifact`、`ExportOptions{fps?,max_width?,loop_count?}`。

### 2.2 并发/会话管理

| 结构 | 职责 |
| --- | --- |
| `ActiveRecording` | id、stop/pause/cancelled（AtomicBool）、elapsed_ms（AtomicU64）、finished: `Mutex<Option<Result<Artifact,String>>>`、finishing（CAS 停止去重）、recording_esc_registered（Esc 注册归属） |
| `FinishAttempt`（RAII） | `begin` 用 finishing CAS 保证"并发停止只有一个收尾"；complete 提交、drop 未完成则复位 |
| `RecorderState`（manage） | active: `Mutex<Option<ActiveRecording>>`、artifacts: `Mutex<HashMap<String, Artifact>>` |

### 2.3 FFmpeg 命令构建（纯函数，可测）

- `build_ffmpeg_args(...)`：rawvideo stdin 路径（`-f rawvideo -pix_fmt rgba -framerate N -i pipe:0 -use_wallclock_as_timestamps 1`）；
- `build_ffmpeg_args_for_encoder(..., encoder)`：libx264 → CRF 18/22/28 + veryfast；h264_mf/libopenh264 → `-b:v` 16M/8M/3M；统一 `-pix_fmt yuv420p -movflags +faststart -fps_mode vfr`（**VFR 不补帧不丢帧**）；
- `append_encoding_args`：音频 `-f dshow`（麦克风）/`-f wasapi`（系统声）；双路 amix；`-c:a aac -b:a 128k -shortest`；
- `build_gdigrab_ffmpeg_args(...)`：**FFmpeg 原生 GDI 采集**（`-f gdigrab -draw_mouse -i desktop`），采集在 FFmpeg 进程内完成，绕开每帧 RGBA 复制瓶颈。

### 2.4 命令（12 个）

`list_capture_monitors` / `list_capture_windows`（过滤：非最小化、宽高>32、标题非空、**排除自身进程**）/ `list_audio_sources`（运行 `ffmpeg -list_devices true -f dshow -i dummy` 解析 stderr）/ `start_recording` / `pause_recording` / `resume_recording` / `stop_recording` / `cancel_recording`（finish 后删产物）/ `export_recording`（mp4=复制；gif=`export_gif`；默认路径 rfd 对话框）/ `get_recording_preview` / `reveal_recording_in_folder`（`explorer.exe /select,`，**只允许按 session_id 查 artifacts，拒绝任意路径**）/ `prepare_gif_editor`（fps=12/max_width=800 预转 `{id}-edit.gif`）。

### 2.5 start_recording 时序

1. Windows 校验 + `target_dimensions`（窗口模式以 xcap 实际捕获像素为准，适配高 DPI）；
2. `resources::lease("ffmpeg")` **资源租约**（防录制中资源被卸载）；
3. CaptureGuard 共享锁内：检查截图冲突 → 单录制槽位 → 规范化 fps(1..60)/quality；
4. 会话 id = `recording-{now_millis()}`，输出缓存目录 `{id}.mp4`；
5. `cached_select_video_encoder`：优先 libx264 → libopenh264 → h264_mf（**每次重新探测，不缓存进程级结论**，因资源切换可能更换 exe/DLL）；
6. 注册 Esc → spawn 捕获线程 → 隐藏主窗 → emit 初始状态。

**捕获线程**：`gdigrab_capture_rect`（monitor/region 走原生；window 返回 None 走 xcap raw 路径）→ 先确保高亮覆盖层成功再启动编码器 → 主循环（暂停→收尾当前 segment-{n}.mp4 + 冻结计时；恢复→开新片段；raw 路径逐帧 `refresh+capture` → 可选画光标 → letterbox → 帧调度器二次校验 → write_frame → 每秒 emit 实际 fps）→ 结束：`concat_recording_segments`（多片段 `ffmpeg -f concat -c copy`）→ `probe_recording_fps` → 产出 Artifact → finalizer（与停止/取消同锁决定终态）→ 注销 Esc → 存 artifacts → 恢复主窗 → emit stopped/error → **最后**释放槽位。

### 2.6 GIF 导出安全替换

`export_gif_with_ffmpeg`：`fps=N,scale=min(W,iw):-1:flags=lanczos,split[pal][x];[pal]palettegen[p];[x][p]paletteuse`；先写临时文件 → `replace_gif_export_with` **三步替换**（旧→`.previous-*` 备份 → 临时→目标（失败回滚）→ 删备份）；静态 `GIF_EXPORT_REPLACE_LOCK` 串行化。错误摘要统一**脱敏**（取 stderr 末 4 行、替换本地路径、700 字符截断）。

## 3. recorder/window_capture.rs — 窗口采集（149 行）

- `WindowCapture`：**保留同一窗口实例**（不像 `Window::all` 每帧枚举）；`refresh()` Windows 下经 `GetWindowThreadProcessId/IsWindow/IsWindowVisible/IsIconic` 校验**存在 + 未最小化 + PID 未变**（防 PID 复用）；
- `validate_window_state(exists, minimized, same_process)`：错误文案"目标窗口已关闭或失效"/"目标窗口已最小化"（失效时停止而非截桌面）；
- `fit_window_frame(frame, w, h)`：尺寸变化 Triangle 缩放 + 黑底居中 letterbox；**GDI 帧 alpha=0 但 RGB 有效**，`imageops::replace` 不做 alpha 混合。

## 4. screenshot.rs — 截图与长截图（1229 行）

### 4.1 会话状态机

常量：`SCREENSHOT_READY_TIMEOUT=8s`（首帧看门狗）、`SCREENSHOT_START_TIMEOUT=12s`、`LONGSHOT_BORDER_WIDTH=3.0`（外环边框不入镜）。

`ScreenshotState`：`screen_data: Mutex<Option<ScreenshotCapture{generation, mode, path}>>`、`minimize_before_capture: AtomicBool`（默认 true，持久化 `app_config_dir/screenshot.json`）、`restore_main_*`（恢复策略）、`in_progress`（防快捷键重入）、`window_ready`、`generation: AtomicU64`（区分前后会话，防旧看门狗误清新会话）。方法族：`try_begin_session()`（CAS + generation+1）、`mark_current_ready()`、`should_cleanup(gen)`、`release_if_generation(gen)` 等。

`PendingScreenshotFile`：RAII —— **未 retain() 的半成品 Drop 时自动删除**。

### 4.2 start_screenshot 流程

1. CaptureGuard 锁内检查冲突 + `try_begin_session()` 取 generation；
2. 按 mode 决定主窗处理（recording+最小化偏好 → minimize+hide+**DwmFlush 等合成器提交**防残影；longshot → hide）；
3. `register_screenshot_esc`（全屏窗未获焦点时的兜底退出）；
4. `timeout(12s, do_start_screenshot)`：spawn_blocking GDI 截屏（`GetDC/BitBlt(SRCCOPY|CAPTUREBLT)/GetDIBits` 负高度免翻转、BGR→RGB；非 Windows 回退 xcap）→ 按 DPI 缩放 → 写**无压缩 PNG**（避免大体积 base64 IPC）到 `screenshot-session-{gen}.png` → 登记 → emit `screenshot-capture-ready {generation}`；
5. 8 秒看门狗：会话仍在 + generation 未变 + 未 ready → 清理（隐藏窗、释放会话、删缓存、恢复主窗、recording 模式 emit `recording-region-cancelled`）。

### 4.3 命令（14 个）

`get_screenshot_settings` / `set_screenshot_minimize_before_capture` / `start_screenshot{mode?}` / `start_recording_region_selection{minimize_before_capture}`（临时覆盖不写配置）/ `get_screen_capture` / `copy_image_to_clipboard{base64_data}`（**与剪贴板监控共用 clipboard_lock 防句柄冲突**）/ `save_image_dialog`（先隐藏截图窗否则原生对话框收不到输入）/ `close_screenshot_window`（隐藏+复位，保留 WebView 复用）/ `show_screenshot_window{generation}`（首帧提交后 fullscreen+show+focus）/ `capture_screen_region{x,y,w,h}`（spawn_blocking；GDI 截取 → CSS 坐标换算 → Lanczos3 缩放，长截图连拍用）/ `send_scroll_wheel{x,y,notches}`（SetCursorPos + SendInput MOUSEEVENTF_WHEEL，长截图自动滚动）/ `start_longshot_panel`（建边框窗 `index.html#/longshot-panel?x&y&w&h&i&a`；interval 300..3000ms；光标穿透 + auto 时隐藏光标 + 注册临时 Esc）/ `close_longshot_panel`。

## 5. clipboard.rs — 剪贴板监控（1127 行）

### 5.1 结构

- `win_clipboard` FFI 子模块：`DROPFILES` 结构 + `OpenClipboard/SetClipboardData/GlobalAlloc...`；`get_clipboard_files()`（解析 CF_HDROP，UTF-16 与 ANSI）；`set_clipboard_files(&[PathBuf])`；
- `ClipboardEntry{id, content_type: Text|Image|Files, text?, file_paths?, image_filename?, preview, timestamp}`；`ClipboardEntryView`（列表**不含缩略图**，按需加载）；
- `ClipboardHistoryState`：entries（上限 200）、config_dir、`clipboard_lock`（监控线程与手动复制互斥）、`ignore_own_write`（本进程写入后下一轮只更新基准）、`image_hashes`（图片 SHA-256 去重缓存）。

### 5.2 监控线程（800ms 轮询）

初始化：当前剪贴板 text/image/files 的 SHA-256 作为基准**不记录**；循环：持 clipboard_lock → 消费 ignore_own_write → **优先 CF_HDROP 文件检测**（在创建 arboard 实例前防句柄冲突）→ text → image；变化时 `add_entry`：`place_clipboard_entry` 去重（文本比对/文件列表比对/图片经 images_match 文件长度+SHA-256）→ 已存在移顶沿用 id 并丢弃重复图片文件 → 超限裁尾（删图片文件）→ `save_history` + emit `clipboard-new-entry`。

### 5.3 命令（9 个）

`init_clipboard_history` / `get_clipboard_history` / `get_clipboard_thumbnail(id)`（惰性）/ `get_clipboard_image(id)` / `copy_text_to_clipboard{text, id?}`（写后 mark_own_write；带 id 时移顶不新建）/ `copy_image_from_history` / `copy_files_to_clipboard`（Windows CF_HDROP）/ `delete_clipboard_entry`（连带删图片文件）/ `clear_clipboard_history`（删 `clipboard_images` 目录）。

## 6. hotkey.rs — 全局快捷键

- 5 动作常量：`showWindow/stickyNote/screenshot/longshot/screenRecorder`；默认绑定 `Alt+Home / Alt+N / Alt+Q / Alt+W / Alt+E`；
- `HotkeyState{bindings: Mutex<HashMap<String,String>>}`；`load_hotkey_bindings`（读 `app_config_dir/hotkeys.json`，缺失补默认）/ `save_hotkey_bindings` / `register_all` / `unregister_all` / `find_action(app, &Shortcut)`；
- 命令：`update_hotkey(action, shortcut)`（解析校验 → 冲突检查 → 注旧注新 → 持久化）、`get_hotkeys`、`reset_hotkeys`。

## 7. capture_guard.rs — 捕获并发拦截（92 行）

- `CaptureGuardState(Mutex<()>)`：**串行化所有捕获工具的"检查并启动"临界区**；
- `CaptureActivity`：Idle / Screenshot / Longshot / Recording；`CaptureShortcut`：Screenshot / Longshot / Recording；
- `decide_shortcut(activity, shortcut) -> Start | Ignore | StopRecording`：Idle→Start；Recording+Recording→StopRecording；其余 Ignore（**已有捕获会话时忽略其他工具快捷键，仅录屏键可停止当前录制**）。

## 8. system_monitor.rs — 系统监控（87 行）

`SystemStats{cpu_usage, cpu_count, memory_used/total_bytes, network_received/transmitted_bytes_per_sec, uptime_seconds, host_name}`；`SystemMonitorState{system, networks, last_network}`；命令 `get_system_stats`：refresh_cpu_usage + refresh_memory + networks.refresh；网速 = 增量÷秒（**首采样返回 0**）。

## 9. ws_server.rs — WebSocket 服务端（230 行）

`WsServerState{shutdowns: HashMap<String, broadcast::Sender<()>>, clients: Arc<Mutex<HashMap<String, WsSink>>>}`。命令：
- `start_ws_server(port)`：server_id = `ws-server-{port}`（重复启动报错）；绑定 127.0.0.1；tokio accept 循环，每连接 spawn `handle_connection`（client_id 自增）；
- `stop_ws_server()`：关停信号 + 逐个 Close；
- `ws_broadcast(message)`：向所有 client 发 Text。

`handle_connection`：`accept_async` → emit `ws-client-connected` → split 存 write half → 读循环 Text/Binary（格式化 `[Binary N bytes]`）→ emit `ws-message-received {clientId, message}`；断开 → emit `ws-client-disconnected`。

## 10. file_saver.rs — 文件对话框与恢复快照（217 行）

`OpenedTextFile{path, contents}` / `OpenedBinaryFile{path, contents(base64)}` / `RecoverySnapshot{id, tool, content, document_path?, updated_at}`。辅助：`safe_segment`（`[A-Za-z0-9_-]{1,128}` **防路径注入**）。

命令（7）：`open_text_file_dialog` / `open_binary_file_dialog` / `pick_existing_file`（**只取路径不读内容**，适配被锁定文件）/ `write_recovery_snapshot` / `list_recovery_snapshots`（顺带清理 >30 天旧快照，按 updated_at 倒序）/ `discard_recovery_snapshot` / `save_file_dialog(bytes, default_name, filter_name, extensions)`（**前端产物统一落盘出口**）。

## 11. plantuml.rs — PlantUML 常驻 JVM 池（306 行）

- `WORKERS: OnceLock<Mutex<HashMap<String/*format*/, PlantUmlWorker>>>`；`PlantUmlWorker{paths, child, stdin, requests: Sender<()>, results: Receiver<Result<Vec<u8>,String>>}`，Drop kill 子进程；
- 命令行：`-Djava.awt.headless=true -jar <jar> -charset UTF-8 -t{svg|png} -pipe`（`path_for_java` 剥离 `\\?\` 扩展路径前缀）；
- `render_with_worker`：池中 worker 路径与当前不一致则重建（**资源切换后不复用旧 JVM**）；写源码 → flush → 发请求 → `recv_timeout(2s)`；超时/断开 kill 并移出池；
- `apply_scheme(source, scheme)`：dark 时插入 `!theme cyborg`；`MAX_SOURCE_BYTES=2MB`；
- `warm_up`（lease java+plantuml → 预 spawn svg worker 渲染空文档）；`stop_idle_workers()`（**由 resources Operation::begin 在 java/plantuml 变更前调用**）；
- 读线程按格式解析输出：`read_svg`（逐字节直到 `</svg>`）/ `read_png`（PNG magic + chunk 长度直到 IEND）；
- 命令 `render_plantuml(app, source, scheme, format) -> Vec<u8>`（先 lease 两个资源）。

## 12. chromium.rs — HTML→PDF/PNG（239 行）

`chromium_path(app)` = `resources::resolve(app, "chromium")`（chrome-headless-shell.exe）。命令（2，spawn_blocking + lease）：
- `render_html_to_pdf(app, html)`：临时目录写 `document.html` → `file:///` URL 启动，公共离线参数（`--headless --disable-gpu --no-sandbox --disable-extensions --disable-background-networking --user-data-dir=<tmp>/profile --virtual-time-budget=1000` 等）+ `--no-pdf-header-footer --print-to-pdf=`；
- `render_html_to_png(app, html, width?, height?)`：+ `--hide-scrollbars --window-size={w|1440},{h|10000} --screenshot=`；
- `run_chromium`：50ms 轮询 try_wait，**30 秒超时 kill**；读产物后删临时目录。

## 13. process_tools.rs — 端口/文件占用（679 行，Windows-only）

- `ProcessTarget{pid: u32, creation_time: u64}`（**创建时间防 PID 复用误杀**）；`ProcessOwner{target, name, executable_path?, endpoints}`；`TerminationStatus`：Terminated/AlreadyExited/AccessDenied/Protected/IdentityChanged/Failed；
- 纯函数：`validate_port`、`matches_process_identity`、`is_protected_target`（pid 0/4/自身/critical）、`is_process_gone_hresult`（0x80070057）、`group_port_rows`、`map_termination_attempts`、`canonical_regular_file`；
- 命令（3）：
  - `find_port_owners(port)`：`GetExtendedTcpTable/GetExtendedUdpTable`（TCP4/6 + UDP4/6，两次调用模式：先查字节数再取数据）；
  - `find_file_lock_owners(path)`：**Restart Manager**（`RmStartSession/RmRegisterResources/RmGetList` 两段式，RAII 会话保证 RmEndSession）；
  - `terminate_processes(targets)`：OpenProcess → GetProcessTimes 比对创建时间（不符→IdentityChanged）→ IsProcessCritical（→Protected）→ TerminateProcess → WaitForSingleObject 5s。

## 14. sticky_note.rs — 悬浮便签（1256 行）

- 常量：窗口 500×460 / min 440×340、`MAX_NOTE_LENGTH=50_000`、贴边参数（`EDGE_HIDE_TRIGGER_DISTANCE=16`、`EDGE_HIDE_REVEAL_SIZE=4` 露出条、`EDGE_HIDE_DELAY=120ms`、展开 220ms/收起 150ms 动画）；无边框（自定义标题栏走 Rust 拖动）且**不透明**（防透明 WebView 拦截鼠标）；
- **贴边算法**（纯函数，测试覆盖极全）：`edge_hide_target`（原生拖动保留偏移量）、`monitor_has_adjacent_neighbor`（**多显示器内部接缝不收起**）、`edge_hidden/expanded_position`、`animated_position`（三次方缓动）、`watch_sticky_note_edge_reveal`（25ms 轮询任务：光标进露出条→动画恢复；离开超 120ms→动画收起）；
- 数据模型：`StickyNotesDocument{notes[], active_id, always_on_top}`（serde default + camelCase）；`normalize_note`（50k 截断 + 颜色白名单 yellow|lime|pink|blue|purple）、`normalize_document`（补 id/title、timeline 去空倒序、修正 active_id）；持久化 `app_config_dir/sticky-note.json`；
- 命令（9）：`get_sticky_note(s)`（**legacy 单便签自动迁移为 document**）/ `update_sticky_note(s)`（同步置顶 + 落盘）/ `hide_sticky_note` / `start_sticky_note_drag`（window.start_dragging）/ `expand_sticky_note_from_edge` / `set_sticky_note_always_on_top` / `show_sticky_note_window`；
- 非命令入口：`toggle_sticky_note`（快捷键）、`show_sticky_note`（按需建窗：无边框、不可最大化、置顶可切换、skip_taskbar=false）、`hide_sticky_note_at_edge`（lib.rs Moved 事件调用）。

## 15. window_chrome.rs — 窗口样式（67 行）

命令 `set_window_chrome(window, background, foreground, dark)`：跨平台 set_theme + set_background_color；Windows 下 `DwmSetWindowAttribute` 设 DWMWA_CAPTION_COLOR(35)/TEXT_COLOR(36)/BORDER_COLOR(34)/WINDOW_CORNER_PREFERENCE(33)=ROUND(2)/USE_IMMERSIVE_DARK_MODE(20)。`rgb(hex)` 解析、`colorref(r,g,b)` 字节序转换。

## 16. resources/ — 按需资源管理

详见 [08-资源按需管理系统](08-资源按需管理系统.md)。模块组成：
- [catalog.rs](../../src-tauri/src/resources/catalog.rs)：`include_str!("../../resource-catalog.json")` 编译期内嵌目录（OnceLock 单例）+ `ocr_request` 白名单映射；
- [mod.rs](../../src-tauri/src/resources/mod.rs)：4 级解析、lease/Operation 互斥、下载/导入/移除/镜像 9 个命令、`read_ocr_asset`；
- [install.rs](../../src-tauri/src/resources/install.rs)：`safe_relative`/`reject_links`/`verify_directory`/`install_archive_validated`（staging + 原子换入）；
- [probe.rs](../../src-tauri/src/resources/probe.rs)：`validate(id, path)` 运行时兼容性探测 + `system_candidates(id)` 系统候选（支持 `NIUERY_FFMPEG_PATH/NIUERY_CHROMIUM_PATH/NIUERY_JAVA_PATH` 环境变量覆盖）。

## 17. build.rs 与 main.rs

- [build.rs](../../src-tauri/build.rs)：Windows 目标下向 examples 追加 `/MANIFEST:EMBED` + comctl32 v6 依赖（resource_smoke 的 rfd 对话框需要），随后 `tauri_build::build()`；
- [main.rs](../../src-tauri/src/main.rs)：release 下 `windows_subsystem = "windows"`（隐藏控制台）→ `niuery_toolkit_lib::run()`。

## 18. 外部进程集成方式汇总

| 外部程序 | 查找 | 调用方式 | 生命周期 |
| --- | --- | --- | --- |
| FFmpeg | `resources::resolve("ffmpeg")`（4 级） | 子进程：rawvideo 模式 stdin 管道喂 RGBA 帧；gdigrab 模式 FFmpeg 自采集、stdin 写 `q\n` 结束（写 MP4 尾不能 kill）；辅助：`-encoders`（编码器选择）、`-list_devices`（音频枚举）、concat（暂停分片拼接）、`-progress`（帧率探测）、palettegen/paletteuse（GIF） | 每次录制短期子进程 + lease 防热切换；编码器选择不跨进程缓存 |
| Chromium | `resolve("chromium")` | headless CLI（`--print-to-pdf`/`--screenshot`），临时目录 + file://，30s 超时轮询 | 每次渲染短期子进程 + lease |
| Java + PlantUML | `resolve("java")` + `resolve("plantuml")` | `-pipe` 模式，**常驻 worker 池**：stdin 写源码、mpsc 请求信号、读线程解析输出；2s 超时 kill 重建 | warm_up 预热；资源变更前 stop_idle_workers；路径不一致自动重建 |
| explorer.exe | — | `explorer.exe /select,{path}`（仅 session_id 索引） | 一次性 |
| cmd / npm | — | dev_server（debug-only）拉起 Vite | 退出时 taskkill 清理 |
