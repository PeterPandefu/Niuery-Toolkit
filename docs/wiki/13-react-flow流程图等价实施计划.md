+# React Flow 流程图能力等价实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 React Flow 编辑器中实现 draw.io 标准流程图的核心编辑能力等价，包括语义形状、连接器属性、排版操作、图层操作、稳定历史和 JSON schema 迁移。

**Architecture:** 保留 `FlowBoard.tsx` 作为页面编排层，将流程图语义与节点默认值放在 `node-registry.ts`，将纯编辑操作放在可测试的 `operations.ts`，将文档兼容逻辑放在 `document.ts`。React Flow 继续负责画布渲染、拖拽和视口；业务操作先计算新文档，再统一进入历史栈。

**Tech Stack:** React 19, TypeScript, `@xyflow/react`, Vitest, existing local file-save APIs.

## Global Constraints

- 不复制 draw.io 的品牌、云厂商图标或完整 UI。
- 不引入实时协作或 draw.io 文件兼容作为本切片目标。
- 保留现有本地 JSON 保存、SVG/PNG 导出入口。
- 所有新增纯逻辑先写失败测试，再写最小实现。
- 不提交 Git，保留用户工作区其他改动。

---

### Task 1: 流程图语义模型和文档兼容

**Files:**
- Modify: `src/tools/graphic/flow-board/types.ts`
- Modify: `src/tools/graphic/flow-board/node-registry.ts`
- Modify: `src/tools/graphic/flow-board/document.ts`
- Test: `src/test/flow-board-document.test.ts`

- [ ] 为节点增加 `semanticType`，为边增加可选的 `routing`、`startMarker`、`endMarker`、`dashed` 字段。
- [ ] 增加 terminator、process、decision、io、document、database、predefined、connector、note 等标准流程图节点。
- [ ] 让旧 schema v1 节点按原 shape 自动迁移到新语义类型。
- [ ] 运行文档测试，确认旧 JSON 仍可打开，新字段可序列化。

### Task 2: 纯编辑操作和历史快照

**Files:**
- Create: `src/tools/graphic/flow-board/operations.ts`
- Test: `src/test/flow-board-operations.test.ts`
- Modify: `src/tools/graphic/flow-board/FlowBoard.tsx`

- [ ] 编写失败测试：对齐、分布、置顶/置底、删除节点同时删除关联边、边样式更新。
- [ ] 实现纯函数 `alignNodes`、`distributeNodes`、`reorderNodes`、`removeNodes`、`updateEdges`。
- [ ] 统一所有节点/边变更经过文档快照进入撤销栈，避免 `onNodesChange` 只改 UI 不入历史。
- [ ] 接通工具栏和右侧检查器按钮。

### Task 3: 流程图节点渲染与连接器交互

**Files:**
- Modify: `src/tools/graphic/flow-board/FlowBoard.tsx`
- Modify: `src/tools/graphic/flow-board/styles.css`
- Modify: `src/tools/graphic/flow-board/node-registry.ts`

- [ ] 为不同语义节点提供稳定的形状 class 和可读的流程图标签。
- [ ] 增加连接工具状态、四向连接点、边标签编辑入口和线型/箭头设置。
- [ ] 保持拖拽添加、点击添加、删除、复制、快捷键行为。
- [ ] 增加多选后排版操作的可见状态。

### Task 4: 导出和回归验证

**Files:**
- Modify: `src/tools/graphic/flow-board/export.ts`
- Modify: `src/test/flow-board-export.test.ts`
- Test/Run: focused Vitest, TypeScript build, ESLint

- [ ] 导出 SVG 时保留新节点形状、边标签、虚线和箭头。
- [ ] 运行 `flow-board-document`、`flow-board-operations`、`flow-board-export` 测试。
- [ ] 运行 `npm run build` 和针对改动文件的 ESLint。
- [ ] 检查工作区 diff 和未授权文件，报告未覆盖的泳道/容器/自动布局后续项。
