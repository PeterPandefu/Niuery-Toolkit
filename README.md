# Niuery Toolkit

离线优先的开发者工具箱，基于 Tauri v2 + React 19 构建的桌面应用。绝大多数工具在本地运行；翻译、HTTP API 和 WebSocket 等工具会在明确使用时访问网络。

[版本变更记录](CHANGELOG.md) · [版本发布指南](docs/releasing.md)

## ✨ 功能亮点

- **50 款开发工具**，覆盖 10 个分类，集中处理开发中的高频任务
- **数据、编码与文本处理**，提供格式化、转换、校验、正则、Markdown 编辑等日常能力
- **图像与文档工作台**，集成图片处理、SVG 优化、PDF 处理及应用图标生成
- **离线画布工具**，支持思维导图、Excalidraw 白板和 Tldraw 白板的本地创作与导出
- **截图与录制**，支持截图标注、区域/窗口/显示器录制和 GIF 编辑导出
- **接口与网络调试**，内置 HTTP API 与 WebSocket 调试工具
- **系统工具**，提供资源监控、剪贴板历史和占用解除（端口、文件、文件夹）
- **按需加载的工具生命周期**，支持常驻运行和快捷固定栏
- **快速检索**，通过 `Ctrl/Cmd + K` 模糊搜索并切换工具，支持中文拼音
- **桌面体验**，支持系统托盘、开机自启和可配置全局快捷键
- **外观与语言**，提供 6 款皮肤、氛围开关、指针流苏/光晕、浅色/深色/跟随系统主题，以及中英双语界面

---

## 🧰 工具列表

### 数据与转换（12）

| 工具         | 说明                                        |
| ------------ | ------------------------------------------- |
| JSON ↔ YAML | JSON 与 YAML 双向实时转换                   |
| XML ↔ JSON  | XML 与 JSON 双向转换                        |
| 时间戳转换   | Unix 时间戳与日期互转                       |
| 进制转换     | 二/八/十/十六进制互转                       |
| 颜色与取色   | 颜色选择、UI 色卡、传统色、渐变色、图片取色 |
| 数据单位换算 | B/KB/MB/GB/TB 数据大小互转                  |
| 角度转换     | 度 / 弧度 / 梯度互转                        |
| 坐标归属查询 | 根据经纬度离线查询所属中国省级行政区        |
| JSON 格式化  | JSON 美化、压缩与校验                       |
| XML 格式化   | XML 美化与压缩                              |
| SQL 格式化   | SQL 查询美化                                |
| 数据报告生成器 | JSON 数据表格预览与 PDF/PNG 导出             |

### 编码与安全（9）

| 工具         | 说明                            |
| ------------ | ------------------------------- |
| Base64       | 文本 / 文件 Base64 编解码       |
| URL 编解码   | URL 组件编解码                  |
| HTML 实体    | HTML 实体编解码                 |
| Unicode 转义 | Unicode 转义 / 反转义           |
| JWT 解析器   | JWT 令牌解析与验证              |
| GZip 压缩    | GZip / Deflate 文本压缩解压     |
| 哈希计算     | MD5/SHA1/SHA256/SHA512 哈希计算 |
| 密码生成器   | 安全密码生成                    |
| 文件校验和   | 文件校验和计算                  |

### 文本与代码（10）

| 工具            | 说明                   |
| --------------- | ---------------------- |
| Markdown 编辑器 | 实时预览、工具栏与导出 |
| 文本对比        | 两段文本差异比对       |
| 正则测试        | 正则表达式测试         |
| 大小写转换      | 命名风格转换           |
| 文本分析        | 字符统计分析           |
| 转义处理        | 字符串转义处理         |
| HTML 离线渲染器 | HTML 本地预览与 PDF/PNG 导出 |
| Mermaid 实时编辑器 | Mermaid 图表实时编辑、预览与导出 |
| PlantUML 实时编辑器 | PlantUML 图表实时编辑、预览与导出 |
| 悬浮便签        | 桌面悬浮便签与时间轴记录 |

### 生成工具（4）

| 工具             | 说明                           |
| ---------------- | ------------------------------ |
| 二维码生成与识别 | 文本与二维码互转               |
| UUID 与随机 ID   | UUID v1/v4/v5/ULID/NanoID 生成 |
| Lorem Ipsum      | 占位文本生成                   |
| 应用图标生成     | 从图片生成应用图标             |

### 图像与文档（3）

| 工具       | 说明                                                     |
| ---------- | -------------------------------------------------------- |
| 图片工作室 | 图片压缩、转换、尺寸、水印、裁剪、旋转与合并等一站式处理 |
| SVG 优化   | SVG 精简优化                                             |
| PDF 处理   | PDF 合并、拆分、水印、压缩、转图片和提取图片             |

### 图表与画布（3）

| 工具            | 说明                                                              |
| --------------- | ----------------------------------------------------------------- |
| 思维导图        | 离线思维导图，支持本地`.smm` 保存、XMind/Markdown 导入与 PNG/SVG 导出 |
| Excalidraw 白板 | 离线无限白板，支持本地保存、打开与 PNG/SVG 导出                   |
| Tldraw 白板     | 离线无限白板，支持本地`.tldr` 保存、打开与 SVG 导出             |

### 截图与录制（2）

| 工具       | 说明                                      |
| ---------- | ----------------------------------------- |
| 截图与标注 | 屏幕截图捕获与标注编辑                    |
| 屏幕录制   | 区域、窗口与显示器录制，支持 GIF 编辑导出 |

### 接口与网络（2）

| 工具           | 说明                        |
| -------------- | --------------------------- |
| HTTP API 调试  | HTTP API 接口调试测试       |
| WebSocket 调试 | WebSocket 客户端/服务端调试 |

### 系统工具（4）

| 工具           | 说明                                 |
| -------------- | ------------------------------------ |
| 系统监控       | 实时查看 CPU、内存、网络资源使用情况 |
| 剪贴板历史记录 | 剪贴板历史记录与重新复制             |
| 占用解除       | 查找并结束占用端口、文件或文件夹的进程，操作后复查占用状态 |

### 语言翻译（1）

| 工具       | 说明                                 |
| ---------- | ------------------------------------ |
| 多语言翻译 | 百度翻译：多语种互译，自动检测源语言 |

---

## 🛠 技术栈

| 层级       | 技术                                          |
| ---------- | --------------------------------------------- |
| 前端框架   | React 19 + TypeScript                         |
| 构建工具   | Vite 6                                        |
| 样式       | Tailwind CSS 3                                |
| 状态管理   | Zustand（持久化 / sessionStorage）            |
| 代码编辑器 | Monaco Editor                                 |
| 国际化     | i18next（中文 / 英文）                        |
| 路由       | React Router v7                               |
| 画布引擎   | Konva + react-konva（截图标注 / GIF 编辑）    |
| 图表渲染   | ECharts（系统监控）                           |
| 搜索       | Fuse.js（模糊搜索）                           |
| 桌面框架   | Tauri v2（Rust）                              |
| Rust 后端  | 录屏/截图/剪贴板/系统监控/全局快捷键/文件保存 |
| 单元测试   | Vitest + Testing Library                      |
| E2E 测试   | Playwright                                    |
| 代码规范   | ESLint + Husky + lint-staged                  |

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **Rust**（Tauri 桌面构建需要，安装方式见 [rustup.rs](https://rustup.rs/)）
- **Windows**: MSVC 构建工具（`Microsoft Visual C++ Build Tools`）
- **macOS**: Xcode Command Line Tools
- **Linux**: `webkit2gtk` + `libappindicator` 等系统依赖

### 安装

```bash
git clone <repo-url> && cd Niuery-Toolkit
npm install
```

桌面版采用小安装包，Chromium、FFmpeg、Java / PlantUML、OCR 引擎和中英文模型不再随安装包分发。打开需要它们的功能时会提示准备资源，在「设置 → 资源管理」统一下载、重试、取消、离线导入或移除。不会在启动时自动下载；资源准备后可离线使用，文档不上传。Chromium / FFmpeg / Java 优先复用经兼容性检查的本机程序，也可手动选择；移除操作只删除应用管理的文件。

开发环境仍可复用 `src-tauri/resources` 中已有资源。需要准备 Chromium 时显式执行 `npm run prepare:chromium`，安装依赖和普通构建不再触发下载。

### 开发

```bash
# 仅前端（浏览器中运行，部分 Tauri 功能不可用）
npm run dev

# Tauri 桌面应用（完整功能）
npm run tauri:dev
```

### 构建

```bash
# 前端构建
npm run build

# 桌面应用打包
npm run tauri:build
```

桌面构建使用 `build:desktop` 排除 `public/ocr`，普通 `npm run build` 保留网页端 OCR。维护者在完整本地资源齐备后运行 `npm run resources:pack`，生成 `resource-packages/*.zip` 和编入应用的版本 / SHA-256 目录；生成不会自动上传。默认地址是项目 GitHub Releases 的 `resources-v1`，正式分发前必须先发布对应的同名包。HTTPS 镜像只能替换下载位置，不能替换信任的版本或校验值；离线导入也必须匹配内置目录。资源存放在应用数据目录的 `resources-v1/<id>/<version>`，不写入系统程序目录。

资源包更新必须重新生成目录并随应用发布；运行中的录屏 / 渲染会阻止资源替换。校验失败或中断不会激活半成品，已有版本保留。Java 包保留完整运行模块，仅去除启动缓存和开发链接库，暂不做可能影响图表渲染的模块裁剪。

### 测试

```bash
# 单元测试
npm run test

# 单元测试（监听模式）
npm run test:watch

# E2E 测试
npm run test:e2e

# E2E 测试（可视化）
npm run test:e2e:ui
```

### 代码检查

```bash
npm run lint
```

---

## ⌨️ 快捷键

| 快捷键               | 功能                             |
| -------------------- | -------------------------------- |
| `Ctrl/Cmd + K`     | 搜索并切换工具                   |
| 全局热键（可自定义） | 截图、长截图、录屏、呼出主窗口   |
| `Esc`              | 截图/录屏/长截图会话中取消或停止 |

---

## 📁 项目结构

```
niuery-toolkit/
├── src/                          # 前端源码
│   ├── components/               # 通用组件（布局、UI、Markdown 渲染）
│   │   └── layout/               # 布局组件（Sidebar、ToolPanel、SearchDialog 等）
│   ├── hooks/                    # 自定义 React Hooks
│   ├── i18n/                     # 国际化资源（zh / en）
│   ├── lib/                      # 工具库与核心逻辑
│   │   ├── api-client.ts         # HTTP 请求引擎（接口测试）
│   │   ├── curl-parser.ts        # cURL 命令解析
│   │   ├── mock-engine.ts        # Mock 数据引擎
│   │   ├── script-sandbox.ts     # 前置脚本沙箱
│   │   ├── logger.ts             # 统一日志系统
│   │   ├── image-utils.ts        # 图片处理工具
│   │   ├── pdf-utils.ts          # PDF 处理工具
│   │   └── ...
│   ├── registry/                 # 工具注册表（声明式工具定义）
│   ├── store/                    # Zustand 状态管理
│   │   ├── app-store.ts          # 全局应用状态
│   │   ├── tool-lifecycle-store.ts  # 工具生命周期（启动/停止/常驻）
│   │   ├── tool-state-store.ts   # 工具输入输出状态
│   │   ├── log-store.ts          # 日志状态
│   │   └── ...
│   ├── tools/                    # 各工具实现（按分类组织）
│   │   ├── converter/            # 转换器
│   │   ├── encoder/              # 编解码器
│   │   ├── formatter/            # 格式化器
│   │   ├── generator/            # 生成器
│   │   ├── graphic/              # 图形工具（含截图、录屏）
│   │   ├── network/              # 网络工具（API 测试、Socket）
│   │   ├── text/                 # 文本工具
│   │   ├── pdf/                  # PDF 工具
│   │   ├── translate/            # 翻译工具
│   │   └── system/               # 系统监控
│   ├── test/                     # 单元测试
│   └── types/                    # TypeScript 类型定义
│
└── src-tauri/                    # Tauri 桌面应用（Rust 后端）
    ├── src/
    │   ├── lib.rs                # 应用入口：托盘、快捷键、拦截器注册
    │   ├── main.rs               # Rust 入口
    │   ├── recorder/             # 屏幕录制（FFmpeg 编码）
    │   ├── screenshot/           # 截图捕获 + 长截图拼接
    │   ├── clipboard/            # 剪贴板监控与历史
    │   ├── hotkey/               # 全局快捷键注册
    │   ├── system_monitor/       # 系统资源监控
    │   ├── ws_server/            # WebSocket 服务端
    │   ├── capture_guard/        # 截图/录屏并发拦截
    │   ├── file_saver/           # 文件保存对话框
    │   └── icons/                # 应用图标
    └── tests/                    # Rust 单元测试
```

---

## 🏗 架构设计

### 工具注册制

工具通过声明式注册表（[tool-registry.ts](src/registry/tool-registry.ts)）统一管理：

```ts
registerTool({
  id: 'json-yaml',
  name: 'JSON ↔ YAML',
  icon: ArrowLeftRight,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/json-yaml')),
  keywords: ['json', 'yaml', 'yml', '转换', 'convert'],
  description: 'JSON 与 YAML 双向实时转换',
});
```

新工具只需注册即可自动接入搜索、快捷栏、生命周期管理。

### 工具生命周期

参考 uTools 插件模型：工具按需加载（懒组件），通过 `tool-lifecycle-store` 管理运行状态，支持"常驻"配置让指定工具在应用启动时自动挂载。

### 前端 ↔ Rust 通信

前端通过 Tauri IPC（invoke / event）调用 Rust 后端能力，包括：屏幕捕获、视频录制（FFmpeg）、剪贴板监控、系统资源采集、全局热键、文件对话框等。

---

## 📄 License

MIT，详见 [LICENSE](LICENSE)。
