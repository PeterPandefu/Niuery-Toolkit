# draw.io 功能探索

核验日期：2026-10-21
对象：[jgraph/drawio](https://github.com/jgraph/drawio)（`dev` 分支）及其官方文档。
目的：了解 draw.io 的能力边界，并对照 Niuery Toolkit 当前的图表工具规划。

## 结论先行

draw.io 是一个通用的图表与白板编辑器，不只是流程图绘制器。它把以下能力放在同一套可编辑画布中：大量领域图形库、连接器与自动布局、图层/多页/泳道/容器、模板与自定义形状、代码或数据生成图、导入导出、嵌入发布，以及面向集成方的嵌入 API。

它当前源码 README 明确说明：该版本**不提供实时协同编辑**；评论、云存储或宿主平台的协同能力取决于外部集成。源码仓库是 Apache-2.0，但内置图标、stencil 库和模板另有资产使用限制，不能把仓库许可证简单等同于所有视觉资产的许可证。

## 功能地图

| 领域 | 能力 | 对 Niuery Toolkit 的判断 |
| --- | --- | --- |
| 画布 | 无限画布、缩放/平移、网格、标尺、对齐/分布、撤销重做、框选 | React Flow 方案已有部分基础；需要补齐编辑器级体验 |
| 结构 | 图层、多页、容器、组合、泳道、表格、可折叠结构 | 当前最值得补的结构化能力 |
| 连接 | 端口、箭头、标签、正交/折线/曲线连接、自动路由、障碍物避让 | React Flow 规划中已列出正交连线和避让，应提高优先级 |
| 布局 | 树、层次流、水平/垂直流程、径向、有机布局、ELK 相关布局 | 可复用 draw.io 的布局入口设计，优先接 ELK/Dagre |
| 形状 | 通用图形、流程图、BPMN、UML/UML 2.5、ER、DFD、网络、AWS/Azure/GCP/Kubernetes、Cisco、Archimate、C4、SysML、P&ID、机架、Mockup、图标与 Emoji | 领域 stencil 是 draw.io 的核心壁垒；不建议一次性复制全部资产 |
| 模板 | 基础、业务、图表、云架构、工程等模板，模板以 XML + 预览图组织 | 可以先做少量中文开发/架构模板 |
| 数据生成 | Mermaid、CSV 导入并自动布局、SQL 生成关系图、文本/AI 生成可编辑图 | 对现有 Mermaid/AI 助手最有借鉴价值 |
| 编辑属性 | 文字、样式、颜色、线型、连接点、超链接、工具提示、标签、数学公式/LaTeX 类内容 | 可作为节点属性面板的验收清单 |
| 导入 | draw.io XML、JSON、PNG/SVG/PDF 内嵌图数据、部分 Visio `.vsdx` | 与 Niuery 的 JSON 文档模型和导出链路有互操作机会 |
| 导出 | PNG、JPEG、WebP、动画 GIF、SVG、PDF、HTML、XML、JSON、URL；部分图片/PDF/SVG 可嵌入源图数据 | Niuery 已有 SVG/PNG/PDF 基础，可补 JSON/HTML/URL 与可回编辑嵌入 |
| 嵌入 | HTML、SVG、iframe、lightbox、发布链接、`postMessage` 通信；宿主可加载/保存/自动保存/导出 | 若以后把 draw.io 作为外部编辑器嵌入，这是关键 API 面 |
| 集成 | 官方产品形态覆盖云盘、GitHub、Confluence/Jira、Office/Teams、Notion、VS Code 等宿主场景 | Niuery 更适合做本地文件与离线资源集成，而不是复制云协作产品 |
| 扩展 | JavaScript 插件机制，仓库内含匿名化、页面、属性、标签、文本、Trello、Nextcloud 等插件示例 | 可参考“稳定插件入口 + 权限边界”，不宜直接复用资产 |
| 部署 | Web、桌面应用、Docker、WAR、自托管 | 与 Tauri 桌面应用和离线优先方向兼容 |

## 截图对应的界面能力

附图显示的是完整编辑器主题，而不是单一的流程图向导：

- 顶部是文件、编辑、查看、排列、其他、帮助等菜单，以及撤销重做、删除、复制/样式、连接器、插入表格等快捷工具。
- 左侧是可搜索的形状面板，按通用、杂项、高级、基本、箭头、流程图、实体关系、UML 2.5、UML 等分类折叠；底部可加载更多图形库。
- 中间是带网格的画布，支持多页文档（截图底部显示“第 1 页”）。
- 右侧是绘图/样式面板，可切换颜色、圆角、草图风格以及连接器/形状样式。

因此，用户感知到的产品价值主要来自“形状库 + 画布编辑模型 + 属性面板 + 文件/模板体系”的组合，而不是某一种图形语法。

## 对 Niuery Toolkit 的差距判断

### 已有或已有基础

- Mermaid 实时编辑、预览和 PNG/SVG/PDF 导出。
- PlantUML 实时编辑和本地渲染。
- 思维导图，支持 `.xmind`、`.smm`、JSON、Markdown 导入及 PNG/SVG/Markdown 导出。
- Excalidraw 与 Tldraw 自由白板。
- React Flow 结构化图表编辑器方案，已规划无限画布、节点/边、JSON、SVG/PNG、撤销重做。
- AI 助手、Markdown、PDF/HTML 渲染和离线资源管理，为“从文本生成图并导出”提供基础。

### 最值得补的能力

1. **编辑器结构层**：多页、图层、容器/组合、泳道、折叠和页面缩略导航。
2. **连接器质量**：端口约束、正交路由、自动避障、边标签和连接点可视化。
3. **布局与模板**：ELK/Dagre 布局入口、模板预览、按领域加载小型形状库。
4. **互操作**：定义可版本化的 draw.io XML/JSON 适配层；支持 CSV/SQL 生成结构化图；保留图形源数据的 PNG/SVG/PDF 回编辑策略。
5. **AI 入口**：AI 输出结构化节点/边模型，再由自动布局和主题系统生成可继续编辑的图，而不是只输出一张图片。

### 不建议直接照搬

- 全量复制 draw.io 的品牌图标、云厂商 stencil 和模板资产；资产许可与产品商标需要单独核查。
- 把实时多人协作作为 draw.io 本体能力；官方仓库当前明确说该版本不支持实时协同，应该把协同视为宿主存储/评论服务能力。
- 立刻替换现有 Mermaid、PlantUML、Excalidraw 或 Tldraw。更稳妥的产品形态是新增“结构化图表编辑器”，让源码图、自由白板和节点图互补。

## 建议的分期路线

| 阶段 | 交付 | 验收重点 |
| --- | --- | --- |
| P1 | React Flow 编辑器补齐多页、图层、容器、对齐/分布、复制粘贴、正交连接 | 能完成流程图、架构图、数据流图的日常编辑 |
| P2 | ELK/Dagre 自动布局、泳道、表格/列表节点、模板库、节点属性面板 | 从少量节点或 CSV 生成整洁结构图 |
| P3 | draw.io XML/JSON 导入导出适配、PNG/SVG/PDF 源数据嵌入、HTML/URL 发布 | 文件可版本控制、跨工具交接、导出后可回编辑 |
| P4 | AI 结构化生成：文本 → 节点/边/布局 → 可编辑画布；增加 SQL/Mermaid/CSV 互转 | AI 结果可修正、可追踪、可再次导出为源码 |

## 事实边界

- `jgraph/drawio` README 将项目描述为可配置的 diagramming and whiteboarding application，并列出 Web、Docker、WAR 和桌面运行方式。
- 官方导出文档列出 PNG、JPEG、WebP、GIF、SVG、PDF、HTML、XML、JSON、URL 等导出路径，并说明 XML/JSON 保存完整图数据；PNG、SVG、PDF 可选择嵌入图数据以便重新打开。
- 官方导出文档特别建议：程序或 LLM 要解析/操纵图时使用 JSON；浏览器展示优先 SVG/HTML；打印优先 PDF。
- 仓库源码树包含 `.vsdx` 导入器、插件目录、领域 shapes 目录、模板目录和嵌入相关 `Embed.js`/`EmbedFile.js`，这些是“支持范围”的源码证据。

## 一手来源

- [draw.io README](https://github.com/jgraph/drawio/blob/dev/README.md)
- [draw.io 官方仓库](https://github.com/jgraph/drawio)
- [官方文档：Supported export formats](https://www.drawio.com/doc/faq/export-diagram)
- [源码：VSDX importer](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/vsdx/importer.js)
- [源码：Embed.js](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/Embed.js)
- [源码：EmbedFile.js](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/EmbedFile.js)
- [源码：插件目录](https://github.com/jgraph/drawio/tree/dev/src/main/webapp/plugins)
- [源码：形状目录](https://github.com/jgraph/drawio/tree/dev/src/main/webapp/shapes)
- [源码：模板目录](https://github.com/jgraph/drawio/tree/dev/src/main/webapp/templates)

## 与 Niuery Toolkit 的本地文档对应关系

- [React Flow 图表编辑器方案](../wiki/11-react-flow图表编辑器方案.md)
- [前端工具模块](../wiki/04-前端工具模块.md)
- [项目概览](../wiki/01-项目概览.md)
