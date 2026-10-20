# AI 框架迁移实施与验证

核验日期：2026-10-20。范围：仅 AI 助手。代码保存在本地，未提交、推送或发布。

## 已实施

- 前端使用 `@assistant-ui/react 0.15.30` 的 ExternalStoreRuntime、Thread/Message/ActionBar Primitives。真实消息、草稿、回复版本、分叉、摘要和比较仍由 `useAiWorkspace` 管理。
- 发送、编辑重发、重新生成、停止均进入 runtime 回调。跨服务确认可等待，取消不会提交；提交使用正文/附件/服务地址快照，确认期间的新草稿保留。
- 思考对应 reasoning part；保留模型显示开关、生成时展开、手动折叠、完成收起和版本切换。正文中的 `<think>` 不自动变为思考。
- 长会话先投影最近 100 条，使用框架 LoadEarlier 每次展开 100 条。只影响展示；请求上下文、导出、搜索和持久化仍使用完整历史。搜索命中会展开目标消息。
- 后端使用精确固定的 `rig-core/rig-reqwest 0.45.0`，经 Rig Model/CompletionStream 生成。OpenAI 固定 chat/completions；Ollama 固定原生 api/chat。
- 保留自定义 URL 前缀、无 key、显式输出参数/temperature/usage 开关、独立思考字段、流事件上限、超时、取消和部分输出。仅文字内容保持字符串，图片保持多模态数组。
- 默认禁重定向和自动重试；错误正文不读入 IPC，禁记录正文 telemetry。目录探测继续使用原有受控 reqwest 客户端，未改其他工具的网络栈。
- 旧生产生成器与 `protocol.rs` 删除，地址/附件校验移至 `validation.rs`。JSON version=1、IPC DTO、凭据命名空间和本地附件目录不变。

## 结果与证据

| 验证 | 结果 | 本地证据 |
|---|---|---|
| npm 干净安装、依赖范围 | 既有锁文件包版本变动 0、删除 0；新增 86 个依赖条目 | `output/ai-framework-implementation/npm-ci.log`、`lock-audit.py` |
| AI 前端 | 16 文件、148 项通过（含分页、确认取消、新草稿、runtime 编辑） | `final-ai-front-tests.log` |
| 全仓前端 | 879 通过、2 跳过；后续新增分页/取消用例另有定向验证 | `final-front-tests.log` |
| TypeScript、AI 范围 ESLint | 通过 | `actions-tsc.log`、`ai-lint.log` |
| Rust AI | 36 项通过；最终新增显式模型能力覆盖测试见最后日志 | `final-ai-rust-tests.log` |
| Rust 全库 | 105 通过、1 个范围外失败；PlantUML 连续渲染超时单独重跑仍失败 | `full-rust-tests.log`、`plantuml-rerun.log` |
| 真实 HTTP | OpenAI/Ollama、前缀、空 key、图片/文本、参数、UTF-8 分片、多行 SSE、空 DONE、错误/EOF、限流/重定向不重发、心跳/超时/大小限制 | `src-tauri/src/ai_assistant/engine/tests.rs`、`transport.rs`、`tests.rs` |
| Chrome 交互 | 思考折叠、重试、版本、停止、模型开关；102 条消息流式上滚位置保持和回到底部均通过 | `output/playwright/ai-thinking-*.png`、`scroll-browser.log` |
| 真 WebView2 + Tauri + Rig | 独立 identifier 下聊天、重试、版本、停止、重载恢复通过；4 条消息、2 版本、停止前思考保留，原生比较 2 项、摘要 1 项 | `webview-chat-tasks-result.json`、`native-requests.jsonl` |
| Windows release 与 NSIS | 实际生成安装包；无签名验证使用显式 `--no-sign` | `final-desktop-build.log`、`unsigned-bundle.log` |

所有 evidence 文件位于 `output/ai-framework-implementation/`（除表中特别注明）。生成测试服务只接收人工夹具，不使用真实 key 或用户会话。

## 性能

同一 Chrome、开发构建、1000 条相同人工历史，原实现从 HEAD 导出至临时夹具；每组 3 轮、每轮输入/搜索各 10 次。计时包括 Playwright 调度与下一帧，不能视为生产微基准。页加载后仍检索完整 1000 条历史，新界面首屏展示最近 100 条。

| 指标 | 原实现 | 当前实现 |
|---|---:|---:|
| 首屏中位耗时 | 1456 ms | 607 ms |
| 输入 P95 | 567 ms | 59 ms |
| 搜索 P95 | 594 ms | 32 ms |

原始记录：`performance-paged.log`、`performance-results.json`。首次直接渲染全部历史曾出现回退，已以消息 memo 和框架分页修正。多轮堆内存受垃圾回收影响，未据此声称内存降低。当前 release EXE 约 45 MB、NSIS 约 18.5 MB；现存旧安装包属于另一版本，不作为本次迁移增量基准。

## 环境与限制

- React 19、TypeScript 5.8 编译通过。Node 24 下全部 AI 测试通过。
- Node 22.23.3 下 144 项非 PDF AI 测试通过；现有 pdfjs-dist 6.2.108 在 Node 22 测试环境调用 `Promise.try` 导致两项 PDF 用例失败。相关依赖未在本次升级。WebView2 和 Node 24 的 PDF 处理以独立验证为准，不把 Node 22 失败隐藏为迁移全绿。
- Rust 1.97.1 编译通过；Cargo 声明最低版本，release CI 显式安装此工具链。保留项目 reqwest 0.12，Rig 自带 reqwest 0.13。
- Windows lib-test 不继承 `rustc-link-arg-tests` 清单，直接启动可能报 0xc0000139。已提供 `scripts/test-ai-rust.ps1`，仅向已编译测试 EXE 嵌入 Common Controls v6 清单，生产清单继续由 Tauri 管理。
- `npm run lint` 未全绿：扫描既有 Rust target 构建产物，另有范围外 `src/test/utils.test.ts` 常量表达式错误等；不修改无关代码来制造通过。
- 默认带更新签名的构建在缺少私钥时会于打包后报错。显式 `npm run tauri:build -- --no-sign` 验证本地安装包；未签名包不用于自动更新发布。
- 千条历史全部手动展开、多图和 4 模型结果的跨版本内存/启动基准、真实外部服务/公司代理的网络差异不作已完成声明。本地夹具覆盖 2 模型原生比较和摘要的联合验证见 `webview-chat-tasks-result.json`；PDF 上传在独立 WebView2 脚本中未完成，不标为通过。

## 实施调整

- 合并了计划中的若干小文件：`engine/wires.rs` 集中 provider Wire、decoder 与元数据兼容；`engine/mod.rs` 集中消费与 IPC 映射。
- 迁移期间使用已有基线、独立 runtime 测试、真实 HTTP 夹具逐层验证；最终不保留 legacy/rig 产品开关，基线可由 Git HEAD 与开始 diff 恢复。没有失败后重发到旧引擎的逻辑。
- 使用公开的框架 `hasEarlier/onLoadEarlier` 处理长会话，避免增加另一套虚拟列表依赖。

## 复跑

```powershell
npm ci
npm test -- --maxWorkers=2 src/test/ai-assistant
npx tsc -b
npx eslint src/tools/ai-assistant src/test/ai-assistant*.test*
./scripts/test-ai-rust.ps1
npm run tauri:build -- --no-sign
```

原生 WebView2 验证使用独立 `com.niuery.toolkit.ai-framework-verification` 标识和临时验证程序，结果写入 output，不碰正式应用数据；聊天/任务结果见 `webview-chat-tasks-result.json`，PDF 未完成。
