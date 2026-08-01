# Niuery Toolkit

离线优先的开发者工具箱，基于 Tauri v2 构建的跨平台桌面应用。所有工具均在本地运行，无需网络连接，保障数据隐私。

## ✨ 功能特性

### 转换器
- **JSON ↔ YAML** — 双向实时转换
- **XML ↔ JSON** — 双向转换
- **时间戳转换** — Unix 时间戳与日期互转
- **进制转换** — 二/八/十/十六进制互转
- **颜色转换** — HEX/RGB/HSL/CMYK 颜色互转
- **数据大小转换** — B/KB/MB/GB/TB 互转
- **角度转换** — 度/弧度/梯度互转

### 编码器 / 解码器
- **Base64** — 文本/文件 Base64 编解码
- **URL 编解码** — URL 组件编解码
- **HTML 实体** — HTML 实体编解码
- **Unicode 转义** — Unicode 转义/反转义
- **JWT 解析器** — JWT 令牌解析与验证
- **二维码** — 文本与二维码互转
- **GZip 压缩** — GZip/Deflate 压缩解压

### 格式化器
- **JSON 格式化** — 美化/压缩/校验
- **XML 格式化** — 美化/压缩
- **SQL 格式化** — SQL 查询美化
- **Markdown 编辑器** — 实时预览、工具栏、导出

### 生成器
- **UUID 生成器** — UUID v1/v4/v5/ULID/NanoID
- **Hash 生成器** — MD5/SHA1/SHA256/SHA512
- **密码生成器** — 安全随机密码
- **Lorem Ipsum** — 占位文本生成
- **文件校验和** — 文件哈希校验

### 文本工具
- **文本对比** — 两段文本差异比对
- **正则测试** — 正则表达式测试
- **大小写转换** — 命名风格转换（camelCase、snake_case 等）
- **文本分析** — 字符统计分析
- **转义处理** — 字符串转义/反转义

### 图形工具
- **图片压缩** — PNG/JPEG 压缩
- **图片转换** — 格式互转（WebP、AVIF 等）
- **SVG 优化** — SVG 精简优化
- **图标生成器** — 从图片生成多平台应用图标
- **截图** — 屏幕截图捕获与标注

### 网络工具
- **接口测试** — HTTP API 调试（类 Postman/Apifox）
- **Socket 调试** — WebSocket 客户端/服务端调试

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 代码编辑器 | Monaco Editor |
| 国际化 | i18next（中/英） |
| 桌面框架 | Tauri v2 (Rust) |
| 单元测试 | Vitest + Testing Library |
| E2E 测试 | Playwright |
| 代码规范 | ESLint + Husky + lint-staged |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Rust（Tauri 桌面构建需要）
- Windows: MSVC 构建工具

### 安装依赖

```bash
npm install
```

### 开发模式（仅前端）

```bash
npm run dev
```

### 开发模式（Tauri 桌面应用）

```bash
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
```

### 代码检查

```bash
npm run lint
```

## 📁 项目结构

```
src/
├── components/       # 通用组件（布局、UI、Markdown）
├── hooks/            # 自定义 Hooks
├── i18n/             # 国际化资源
├── lib/              # 工具库与核心逻辑
├── registry/         # 工具注册表
├── store/            # Zustand 状态管理
├── tools/            # 各工具实现
│   ├── converter/    # 转换器
│   ├── encoder/      # 编解码器
│   ├── formatter/    # 格式化器
│   ├── generator/    # 生成器
│   ├── graphic/      # 图形工具
│   ├── network/      # 网络工具
│   └── text/         # 文本工具
└── types/            # TypeScript 类型定义

src-tauri/            # Tauri 桌面应用（Rust）
```

## 📄 License

Private
