# 通用界面组件

工具页面从 `@/components/ui/` 导入基础组件。下拉选择统一使用 `Select`，其颜色、边框、选中态、焦点和弹出列表跟随应用主题。

```tsx
import { Select } from '@/components/ui/select';

<Select
  aria-label="输出格式"
  value={format}
  onChange={event => setFormat(event.target.value)}
  options={[
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
  ]}
/>
```

也可以使用 `onValueChange={setFormat}` 接收字符串，或沿用 `<option>`、`<optgroup>` 子节点。`value` 为受控值，`defaultValue` 为初始值；`name`、`form`、`required` 和原生 `change` 事件通过内部表单控件保留。`ref` 指向内部表单控件，`triggerRef` 指向可见按钮，供程序设置焦点。

`onFocus`、`onBlur`、`onKeyDown` 和 `onClick` 接收可见按钮的事件；点击和按键回调可通过 `preventDefault()` 阻止组件默认操作。必填校验失败时，焦点移到可见按钮，并显示错误边框。

选项类型 `SelectOption` 支持 `value`、`label`、`description`、`group`、`disabled` 和 `hidden`。附加配置如下：

| 配置 | 用途 |
| --- | --- |
| `icon` | 触发器左侧的装饰图标 |
| `caption` | 弹出列表标题 |
| `showGroup` | 在选中值旁显示分组名称 |
| `variant="compact"` | 紧凑工具栏样式 |
| `placement` | `auto`、`top` 或 `bottom`，空间不足时自动调整 |
| `placeholder` / `emptyText` | 未选择和无选项时的提示 |
| `className` | 触发器的宽度、高度和字体，例如 `h-8 w-28 text-xs` |

为每个选择器提供 `aria-label` 或通过 `Label htmlFor` 关联 `id`。组件也支持包裹标签和紧邻的 `Label`。键盘使用方向键移动、Home/End 跳到首尾、输入前缀定位、Enter/空格确认、Escape 取消和 Tab 离开。

列表通过 Portal 显示，避免被工具栏的滚动容器裁剪；处于弹窗中时，列表挂载在该弹窗内以保持可访问性。弹窗如果在捕获阶段处理 Escape，应在事件目标为 `[role=combobox][aria-expanded=true]` 时跳过，让选择器先关闭列表。

通用外观维护在 `select.css`，工具专有内容通过参数传入。此组件用于单选下拉框；工具搜索、代码编辑器和第三方画布自身的选择交互保留其专用组件。
