# 06 · IPC 通信与多窗口

> 前端 ↔ Rust 的全部通信面：74 个 invoke 命令、13 种后端事件、自定义协议、前端内部事件总线。

## 1. 通信机制总览

| 通道 | 方向 | 用途 |
| --- | --- | --- |
| `invoke('cmd', args)` | 前端 → Rust | 调用 74 个 `#[tauri::command]` |
| `emit` / `listen('event')` | Rust → 前端 | 13 种事件（`emitTo` 可定向窗口） |
| `resource://` 协议 | 前端 fetch → Rust | OCR 资产受控分发（白名单 + 哈希校验） |
| `asset://` 协议（`convertFileSrc`） | 前端 → 本地文件 | 录制产物播放、拖放文件读取（scope 限 `$CACHE/$APPDATA/$VIDEO/$HOME` 等） |
| window CustomEvent | 前端内部 | `open-resource-manager`、`niuery:hotkeys-changed` |

**防御性模式**：所有 Tauri 交互前判 `isTauri`（`'__TAURI_INTERNALS__' in window`，[api-client.ts](../../src/lib/api-client.ts) 导出）；动态 `import('@tauri-apps/api/*')` 减少首屏包体；listen 统一 `disposed` 标志防卸载泄漏；错误信息脱敏（不泄漏完整本地路径）。

## 2. invoke 命令清单（74 个，按域）

### 2.1 资源管理（resources，9 个）

| 命令 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `list_resources` | app | `Vec<ResourceStatus>` | 状态查询（spawn_blocking） |
| `install_resource` | app, id | `Result<()>` | 下载安装（Operation 排他） |
| `cancel_resource_download` | id | `Result<()>` | 取消下载 |
| `remove_resource` | app, id | `Result<()>` | 移除托管资源（canonicalize 安全校验） |
| `select_local_resource` | app, id, clear | `Result<()>` | 用户自选本地 exe（仅 ffmpeg/chromium/java，probe 验证） |
| `import_resource` | app, id | `Result<()>` | 离线导入本地 zip |
| `set_resource_mirror` / `get_resource_mirror` | url | | HTTPS 镜像配置（不能替换信任根） |
| `get_resource_paths` | app, ids | `HashMap<String,String>` | OCR 资源路径查询 |

### 2.2 截图与长截图（screenshot，14 个）

| 命令 | 说明 |
| --- | --- |
| `start_screenshot{mode?}` | mode ∈ normal/longshot/recording；GDI 截屏 + 会话机 |
| `start_recording_region_selection{minimize_before_capture}` | 录屏区域框选入口 |
| `restore_main_window_after_recording_region` | 框选后恢复主窗（幂等） |
| `get_screenshot_settings` / `set_screenshot_minimize_before_capture` | 截图偏好（持久化 screenshot.json） |
| `get_screen_capture` | 前端轮询拿截图文件路径（预热阶段） |
| `copy_image_to_clipboard{base64_data}` | 复制图片（与监控线程共用 clipboard_lock） |
| `save_image_dialog{base64_data, format?}` | 原生保存对话框（先隐藏截图窗） |
| `close_screenshot_window{generation?}` / `show_screenshot_window{generation}` | 截图窗隐藏复位 / 首帧后显示 |
| `capture_screen_region{x,y,width,height}` | 长截图连拍（GDI+Lanczos3） |
| `send_scroll_wheel{x,y,notches}` | 长截图自动滚动（SendInput） |
| `start_longshot_panel{x,y,width,height,interval_ms?,auto_scroll?}` | 建长截图边框控制窗 |
| `close_longshot_panel` | 关闭连拍面板 |

### 2.3 录屏（recorder，12 个）

`list_capture_monitors` / `list_capture_windows`（排除自身进程）/ `list_audio_sources` / `start_recording{target, settings}` / `pause_recording{session_id}` / `resume_recording{session_id}` / `stop_recording{session_id}` → Artifact / `cancel_recording{session_id}` / `get_recording_preview{session_id}`（原始字节）/ `reveal_recording_in_folder{session_id}` / `export_recording{session_id, format, options, output_path?}` / `prepare_gif_editor{session_id}`（预转 GIF）。

### 2.4 剪贴板（clipboard，9 个）

`init_clipboard_history` / `get_clipboard_history`（无缩略图视图）/ `get_clipboard_thumbnail{id}`（惰性）/ `get_clipboard_image{id}` / `copy_text_to_clipboard{text, id?}` / `copy_image_from_history{id}` / `copy_files_to_clipboard{paths, id?}`（CF_HDROP）/ `delete_clipboard_entry{id}` / `clear_clipboard_history`。

### 2.5 便签（sticky_note，9 个）

`get_sticky_note`（legacy 单便签）/ `get_sticky_notes`（文档）/ `update_sticky_note` / `update_sticky_notes{document}` / `hide_sticky_note` / `show_sticky_note_window` / `start_sticky_note_drag`（原生拖动）/ `expand_sticky_note_from_edge` / `set_sticky_note_always_on_top{always_on_top}`。

### 2.6 文件与恢复快照（file_saver，7 个）

`save_file_dialog{bytes, default_name, filter_name, extensions}`（**前端产物统一落盘出口**）/ `open_text_file_dialog{filter_name, extensions}` / `open_binary_file_dialog{...}`（base64）/ `pick_existing_file` / `pick_existing_folder`（只取路径）/ `write_recovery_snapshot{tool, id, content, document_path?}` / `list_recovery_snapshots{tool}` / `discard_recovery_snapshot{tool, id}`。

### 2.7 渲染引擎桥（chromium 2 + plantuml 1）

| 命令 | 说明 |
| --- | --- |
| `render_html_to_pdf{html}` | Chromium headless 打印（markdown/html-renderer/report-generator/diagram-editor 导出用） |
| `render_html_to_png{html, width?, height?}` | Chromium 截图 |
| `render_plantuml{source, scheme, format}` | 返回 SVG/PNG 字节（JVM worker 池） |

### 2.8 系统（hotkey 3 + system_monitor 1 + process_tools 4 + window_chrome 1）

`get_hotkeys` / `update_hotkey{action, shortcut}` / `reset_hotkeys`；`get_system_stats`（1s 轮询）；`find_port_owners{port}` / `find_file_lock_owners{path}` / `find_folder_lock_owners{path}` / `terminate_processes{targets}`（pid+creationTime 双重身份，创建时间以字符串传输）；`set_window_chrome{background, foreground, dark}`（DWM 标题栏/圆角/暗色）。

### 2.9 WebSocket 服务端（ws_server，3 个）

`start_ws_server{port}` / `stop_ws_server` / `ws_broadcast{message}`。

> **网络请求不走 invoke**：Tauri 下用 `@tauri-apps/plugin-http` 的 fetch（绕 CORS，capability 白名单仅百度翻译端点），浏览器回退 window.fetch。

## 3. 事件系统（Rust → 前端，13 种）

| 事件 | 发送方 | 载荷 | 用途 |
| --- | --- | --- | --- |
| `recording-status` | recorder.rs（app 全局） | `{sessionId, status, elapsedMs, fps, droppedFrames, error?, artifact?}`；status ∈ recording/paused/stopped/error | 录制进度与终态 |
| `screenshot-capture-ready` | screenshot.rs → **screenshot 窗口** | `{generation}` | 截图窗加载新底图 |
| `recording-region-cancelled` | screenshot.rs | `()` | 全局 Esc 关闭框选，解除录屏页"正在框选" |
| `longshot-esc` | lib.rs → **longshot-panel 窗口** | `()` | 长截图会话结束并拼接 |
| `open-longshot-editor` | lib.rs（app） | `()` | 长截图快捷键：切前端到截图编辑器 |
| `open-screen-recorder` | lib.rs（app） | `()` | 录屏快捷键：打开录屏工具 |
| `open-screenshot-ocr` | 截图窗 → main | `{imageDataUrl, text, translate?}` | OCR/翻译移交主窗口 |
| `longshot-region-selected` | 截图窗 → main | `{x,y,width,height}` | 框选完成 → 开连拍面板 |
| `longshot-complete` | → main | `{dataUrl, droppedCount}` | 拼接结果载入编辑器 |
| `clipboard-new-entry` | clipboard.rs | `ClipboardEntryView`（含缩略图） | 剪贴板历史新增/置顶 |
| `ws-client-connected` / `ws-message-received` / `ws-client-disconnected` | ws_server.rs | `{clientId}` / `{clientId, message}` / `{clientId}` | WS 服务端事件桥接 |
| `resource-progress` | resources/mod.rs | `{id, phase: downloading/verifying, received, total}` | 资源下载/校验进度 |
| `resource-operation-ended` | resources/mod.rs | `{id}` | install 结束（无论成败） |
| `resources-changed` | resources/mod.rs | `()` | 安装/导入/移除/本地选择后刷新 |

### 3.1 前端内部事件总线（window CustomEvent）

| 事件 | 方向 | 用途 |
| --- | --- | --- |
| `open-resource-manager` | ResourceNotice/ResourceManager → App.tsx | 打开设置窗资源页 |
| `niuery:hotkeys-changed` | SettingsDialog → 已挂载工具 | 快捷键热更新（截图编辑器等即时刷新显示） |

## 4. 多窗口矩阵

| 窗口 label | 创建方式 | 页面/路由 | 前端组件 | 关键特性 |
| --- | --- | --- | --- | --- |
| `main` | tauri.conf.json 静态 | index.html | `App` | 1280×800 无边框自绘标题栏；关闭三态（退出/托盘/记忆）；单实例聚焦 |
| `screenshot` | setup 预热（隐藏）+ 首次兜底 | `index.html#/screenshot` | `ScreenshotApp` | 全屏透明置顶；**跨会话复用**（close 仅 hide+复位，Destroyed 才释放会话） |
| `longshot-panel` | 每会话新建 | `index.html#/longshot-panel?x&y&w&h&i&a` | `LongshotPanel` | 外环 3px 呼吸边框；光标穿透；Destroyed 注销临时 Esc+恢复光标 |
| `recording-capture-border` | 录屏预热/复用 | `index.html#/recording-capture-border` | `RecordingCaptureBorderOverlay` | 窗口物理边界在采集矩形**外侧**（边框不入镜）；100ms 跟随线程 |
| `recording-cursor-highlight` | 同上（Windows） | `index.html#/recording-cursor-highlight` | `CursorHighlightOverlay` | 32×32 高亮点，16ms GetCursorPos 跟随 |
| `sticky-note` | 快捷键按需创建 | **sticky-note.html**（独立入口） | `StickyNoteApp` | 无边框不透明；贴边隐藏/露出动画；CloseRequested→hide |

**跨窗口协作模式**：Rust 用 `emitTo('main', ...)` 定向投递（截图窗的 OCR/长截图结果回主窗口）；窗口间无直接通信，一律经 Rust 中转或共享 Zustand store（主窗口内）。

## 5. capability 权限模型（[capabilities/default.json](../../src-tauri/capabilities/default.json)）

- `windows: ["main", "screenshot", "longshot-panel"]` —— 插件权限只授予这三个窗口（便签窗、录制覆盖窗无插件权限需求）；
- 权限：`core:default`、`core:event:allow-emit-to`、窗口操作（minimize/unminimize/close/toggle-maximize/start-dragging/show/set-focus）、`opener:default`、`http:default`（**allow 白名单仅 `https://fanyi-api.baidu.com/api/trans/vip/translate`**）、`global-shortcut:default`、`autostart:default`、`dialog:default`、`updater:default`、`process:default`。

## 6. 典型跨端调用示例

```ts
// 前端调用（src/tools/graphic/screen-recorder/useRecorder.ts）
import { invoke } from '@tauri-apps/api/core';
const session = await invoke<RecordingSession>('start_recording', { target, settings });

// 事件监听（App.tsx，disposed 防泄漏）
useEffect(() => {
  if (!isTauri) return;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const un = await listen('open-screenshot-ocr', (e) => { /* ... */ });
    if (disposed) un(); else cleanups.push(un);
  })();
  return () => { disposed = true; cleanups.forEach(fn => fn()); };
}, []);
```
