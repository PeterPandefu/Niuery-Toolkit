# Niuery Toolkit

离线优先的开发者工具箱，基于 Tauri v2 + React 19 构建的跨平台桌面应用。所有工具均在本地运行，无需网络连接，保障数据隐私。

## ✨ 功能亮点

- **43+ 款开发工具**，覆盖日常开发高频场景
- **离线运行**，数据不留本地之外
- **类 uTools 生命周期**，工具按需启动/停止，支持常驻运行
- **全局快捷键** — 截图、长截图、录屏、呼出主窗口一键触发
- **模糊搜索** — `Ctrl/Cmd + K` 快速切换工具，支持中文拼音
- **快捷固定栏** — 高频工具一键直达
- **最近使用** — 自动记录使用历史
- **系统托盘** — 最小化到托盘，支持开机自启
- **深色/浅色主题**，跟随系统自动切换
- **中英双语**，自动检测浏览器语言
- **统一日志系统**，所有工具操作可追溯

---

## 🧰 工具列表

### 转换器

| 工具 | 说明 |
| --- | --- |
| JSON ↔ YAML | JSON 与 YAML 双向实时转换 |
| XML ↔ JSON | XML 与 JSON 双向转换 |
| 时间戳转换 | Unix 时间戳与日期互转 |
| 进制转换 | 二/八/十/十六进制实时互转 |
| 颜色助手 | 颜色选择、UI 色卡、传统色、渐变色、图片取色 |
| 数据大小转换 | B / KB / MB / GB / TB 互转 |
| 角度转换 | 度 / 弧度 / 梯度互转 |

### 编码器

| 工具 | 说明 |
| --- | --- |
| Base64 | 文本 / 文件 Base64 编解码 |
| URL 编解码 | URL 组件 encodeURI / decodeURI |
| HTML 实体 | HTML 实体编解码 |
| Unicode 转义 | Unicode 转义 / 反转义 |
| JWT 解析器 | JWT 令牌解析，Header / Payload / Signature 可视化 |
| 二维码 | 文本生成二维码、二维码解码 |
| GZip 压缩 | GZip / Deflate 文本压缩解压 |

### 格式化器

| 工具 | 说明 |
| --- | --- |
| JSON 格式化 | 美化 / 压缩 / 语法校验 |
| XML 格式化 | 美化 / 压缩 |
| SQL 格式化 | SQL 查询美化，支持多种方言 |
| Markdown 编辑器 | 实时预览、工具栏、导出，支持语法高亮 |

### 生成器

| 工具 | 说明 |
| --- | --- |
| UUID 生成器 | UUID v1 / v4 / v5 / ULID / NanoID |
| Hash 生成器 | MD5 / SHA1 / SHA256 / SHA512 |
| 密码生成器 | 安全随机密码生成，自定义长度与字符集 |
| Lorem Ipsum | 占位文本生成 |
| 文件校验和 | 文件哈希校验 |

### 文本工具

| 工具 | 说明 |
| --- | --- |
| 文本对比 | 两段文本差异比对，高亮显示 |
| 正则测试 | 正则表达式在线测试，匹配/替换 |
| 大小写转换 | 命名风格转换（camelCase / snake_case / kebab-case 等） |
| 文本分析 | 字符/单词/行数统计 |
| 转义处理 | 字符串转义 / 反转义 |
| 粘贴板历史 | 剪贴板历史记录，支持文字和图片重新复制 |

### 图形工具

| 工具 | 说明 |
| --- | --- |
| 图片处理 | 一站式：压缩 / 格式转换 / 修改尺寸 / 水印 / 圆角 / 裁剪 / 旋转 / 翻转 / 图片合并 |
| SVG 优化 | SVG 精简压缩，减少文件体积 |
| 图标生成器 | 图片生成多平台应用图标（favicon / iOS / Android） |
| 截图 | 区域截图 + 标注编辑（画笔 / 箭头 / 文字 / 形状 / 裁剪等） |
| 屏幕录制 | 区域/窗口/显示器录制，导出 WebM / GIF，支持 GIF 帧编辑 |

### 网络工具

| 工具 | 说明 |
| --- | --- |
| 接口测试 | HTTP API 调试（类 Postman）：集合管理、环境变量、前置脚本、批量测试、Mock |
| Socket 调试 | WebSocket 客户端 / 服务端调试 |

### PDF 工具

| 工具 | 说明 |
| --- | --- |
| PDF 工具 | 合并 / 拆分 / 水印 / 压缩 / 转为图片 / 提取图片，全程本地处理 |

### 系统工具

| 工具 | 说明 |
| --- | --- |
| 系统监控 | 实时查看 CPU、内存、网络资源使用情况 |

### 翻译工具

| 工具 | 说明 |
| --- | --- |
| 翻译 | 百度翻译集成，多语种互译，自动检测源语言 |

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

Private
