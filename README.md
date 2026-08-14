# Niuery Toolkit

离线优先的开发者工具箱，基于 Tauri v2 + React 19 构建的跨平台桌面应用。所有工具均在本地运行，无需网络连接，保障数据隐私。

## ✨ 功能亮点

- **43 款开发工具**，覆盖 10 个分类，集中处理开发中的高频任务
- **数据、编码与文本处理**，提供格式化、转换、校验、正则、Markdown 编辑等日常能力
- **图像与文档工作台**，集成图片处理、SVG 优化、PDF 处理及应用图标生成
- **离线画布工具**，支持思维导图、Excalidraw 白板和 Tldraw 白板的本地创作与导出
- **截图与录制**，支持截图标注、区域/窗口/显示器录制和 GIF 编辑导出
- **接口与网络调试**，内置 HTTP API 与 WebSocket 调试工具
- **系统与剪贴板效率工具**，提供系统资源监控和剪贴板历史记录
- **按需加载的工具生命周期**，支持常驻运行、最近使用和快捷固定栏
- **快速检索**，通过 `Ctrl/Cmd + K` 模糊搜索并切换工具，支持中文拼音
- **桌面体验**，支持系统托盘、开机自启和可配置全局快捷键
- **外观与语言**，提供 4 款皮肤、浅色/深色/跟随系统主题，以及中英双语界面

---

## 🧰 工具列表

### 数据与转换（11）

| 工具 | 说明 |
| --- | --- |
| JSON ↔ YAML | JSON 与 YAML 双向实时转换 |
| XML ↔ JSON | XML 与 JSON 双向转换 |
| 时间戳转换 | Unix 时间戳与日期互转 |
| 进制转换 | 二/八/十/十六进制互转 |
| 颜色与取色 | 颜色选择、UI 色卡、传统色、渐变色、图片取色 |
| 数据单位换算 | B/KB/MB/GB/TB 数据大小互转 |
| 角度转换 | 度 / 弧度 / 梯度互转 |
| 坐标归属查询 | 根据经纬度离线查询所属中国省级行政区 |
| JSON 格式化 | JSON 美化、压缩与校验 |
| XML 格式化 | XML 美化与压缩 |
| SQL 格式化 | SQL 查询美化 |

### 编码与安全（9）

| 工具 | 说明 |
| --- | --- |
| Base64 | 文本 / 文件 Base64 编解码 |
| URL 编解码 | URL 组件编解码 |
| HTML 实体 | HTML 实体编解码 |
| Unicode 转义 | Unicode 转义 / 反转义 |
| JWT 解析器 | JWT 令牌解析与验证 |
| GZip 压缩 | GZip / Deflate 文本压缩解压 |
| 哈希计算 | MD5/SHA1/SHA256/SHA512 哈希计算 |
| 密码生成器 | 安全密码生成 |
| 文件校验和 | 文件校验和计算 |

### 文本与代码（6）

| 工具 | 说明 |
| --- | --- |
| Markdown 编辑器 | 实时预览、工具栏与导出 |
| 文本对比 | 两段文本差异比对 |
| 正则测试 | 正则表达式测试 |
| 大小写转换 | 命名风格转换 |
| 文本分析 | 字符统计分析 |
| 转义处理 | 字符串转义处理 |

### 生成工具（4）

| 工具 | 说明 |
| --- | --- |
| 二维码生成与识别 | 文本与二维码互转 |
| UUID 与随机 ID | UUID v1/v4/v5/ULID/NanoID 生成 |
| Lorem Ipsum | 占位文本生成 |
| 应用图标生成 | 从图片生成应用图标 |

### 图像与文档（3）

| 工具 | 说明 |
| --- | --- |
| 图片工作室 | 图片压缩、转换、尺寸、水印、裁剪、旋转与合并等一站式处理 |
| SVG 优化 | SVG 精简优化 |
| PDF 处理 | PDF 合并、拆分、水印、压缩、转图片和提取图片 |

### 图表与画布（3）

| 工具 | 说明 |
| --- | --- |
| 思维导图 | 离线思维导图，支持本地 `.smm` 保存、Markdown 导入与 PNG/SVG 导出 |
| Excalidraw 白板 | 离线无限白板，支持本地保存、打开与 PNG/SVG 导出 |
| Tldraw 白板 | 离线无限白板，支持本地 `.tldr` 保存、打开与 SVG 导出 |

### 截图与录制（2）

| 工具 | 说明 |
| --- | --- |
| 截图与标注 | 屏幕截图捕获与标注编辑 |
| 屏幕录制 | 区域、窗口与显示器录制，支持 GIF 编辑导出 |

### 接口与网络（2）

| 工具 | 说明 |
| --- | --- |
| HTTP API 调试 | HTTP API 接口调试测试 |
| WebSocket 调试 | WebSocket 客户端/服务端调试 |

### 系统与剪贴板（2）

| 工具 | 说明 |
| --- | --- |
| 系统监控 | 实时查看 CPU、内存、网络资源使用情况 |
| 剪贴板历史记录 | 剪贴板历史记录与重新复制 |

### 语言翻译（1）

| 工具 | 说明 |
| --- | --- |
| 多语言翻译 | 百度翻译：多语种互译，自动检测源语言 |

---

## 🛠 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand（持久化 / sessionStorage） |
| 代码编辑器 | Monaco Editor |
| 国际化 | i18next（中文 / 英文） |
| 路由 | React Router v7 |
| 画布引擎 | Konva + react-konva（截图标注 / GIF 编辑） |
| 图表渲染 | ECharts（系统监控） |
| 搜索 | Fuse.js（模糊搜索） |
| 桌面框架 | Tauri v2（Rust） |
| Rust 后端 | 录屏/截图/剪贴板/系统监控/全局快捷键/文件保存 |
| 单元测试 | Vitest + Testing Library |
| E2E 测试 | Playwright |
| 代码规范 | ESLint + Husky + lint-staged |

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

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + K` | 搜索并切换工具 |
| 全局热键（可自定义） | 截图、长截图、录屏、呼出主窗口 |
| `Esc` | 截图/录屏/长截图会话中取消或停止 |

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
