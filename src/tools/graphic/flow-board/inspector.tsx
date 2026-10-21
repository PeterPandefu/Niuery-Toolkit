import type { FlowEdge, FlowNode, FlowNodeData, FlowPage } from './types';

interface Props {
  node?: FlowNode; edge?: FlowEdge; page: FlowPage; count: number;
  begin(): void; finish(): void;
  updateNode(patch: Partial<FlowNodeData>): void;
  updateEdge(patch: NonNullable<FlowEdge['data']>): void;
  arrange(action: string): void;
}
export function FlowInspector({ node, edge, page, count, begin, finish, updateNode, updateEdge, arrange }: Props) {
  const data = node?.data;
  return <div className="flow-inspector-body" onFocus={begin} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) finish(); }}>
    {data ? <>
      <h3>形状样式{count > 1 ? ` · 已选 ${count} 项` : ''}</h3>
      <label>节点文本<textarea aria-label="节点文本" value={data.label} onChange={(event) => updateNode({ label: event.target.value })} /></label>
      <div className="flow-field-row">
        <label>填充<input aria-label="节点填充" type="color" value={data.fill === 'transparent' ? '#ffffff' : data.fill} onChange={(e) => updateNode({ fill: e.target.value })} /></label>
        <label>边框<input aria-label="节点边框" type="color" value={data.stroke === 'transparent' ? '#ffffff' : data.stroke} onChange={(e) => updateNode({ stroke: e.target.value })} /></label>
        <label>文字<input aria-label="文字颜色" type="color" value={data.textColor} onChange={(e) => updateNode({ textColor: e.target.value })} /></label>
      </div>
      <label><input type="checkbox" checked={data.fill === 'transparent'} onChange={(e) => updateNode({ fill: e.target.checked ? 'transparent' : '#ffffff' })} />透明填充</label>
      <div className="flow-field-row"><label>宽度<input type="number" min={40} max={4000} value={data.width} onChange={(e) => updateNode({ width: Math.max(40, Math.min(4000, Number(e.target.value) || 40)) })} /></label><label>高度<input type="number" min={30} max={4000} value={data.height} onChange={(e) => updateNode({ height: Math.max(30, Math.min(4000, Number(e.target.value) || 30)) })} /></label></div>
      <div className="flow-field-row"><label>字号<input type="number" min={8} max={120} value={data.fontSize ?? 14} onChange={(e) => updateNode({ fontSize: Math.max(8, Math.min(120, Number(e.target.value) || 14)) })} /></label><label>线宽<input type="number" min={1} max={12} value={data.strokeWidth ?? 2} onChange={(e) => updateNode({ strokeWidth: Math.max(1, Math.min(12, Number(e.target.value) || 2)) })} /></label></div>
      <div className="flow-field-row"><label><input type="checkbox" checked={Boolean(data.bold)} onChange={(e) => updateNode({ bold: e.target.checked })} />粗体</label><label><input type="checkbox" checked={Boolean(data.italic)} onChange={(e) => updateNode({ italic: e.target.checked })} />斜体</label><label><input type="checkbox" checked={Boolean(data.dashed)} onChange={(e) => updateNode({ dashed: e.target.checked })} />虚线</label></div>
      <label>文本对齐<select value={data.textAlign ?? 'center'} onChange={(e) => updateNode({ textAlign: e.target.value as FlowNodeData['textAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
      <label>所属图层<select value={data.layerId ?? page.layers[0].id} onChange={(e) => updateNode({ layerId: e.target.value })}>{page.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
      <h3>排列</h3><div className="flow-arrange-grid">{[['left', '左对齐'], ['center', '水平居中'], ['right', '右对齐'], ['top', '顶对齐'], ['middle', '垂直居中'], ['bottom', '底对齐'], ['horizontal', '水平分布'], ['vertical', '垂直分布']].map(([action, label]) => <button key={action} disabled={count < (action === 'horizontal' || action === 'vertical' ? 3 : 2)} onClick={() => arrange(action)}>{label}</button>)}</div>
      <div className="flow-arrange-grid"><button onClick={() => arrange('front')}>置于顶层</button><button onClick={() => arrange('back')}>置于底层</button></div>
    </> : edge ? <>
      <h3>连接线</h3>
      <label>连接标签<input value={edge.data?.label ?? ''} onChange={(e) => updateEdge({ label: e.target.value })} /></label>
      <label>连接线类型<select value={edge.data?.routing ?? 'orthogonal'} onChange={(e) => updateEdge({ routing: e.target.value as NonNullable<FlowEdge['data']>['routing'] })}>{[['straight', '直线'], ['orthogonal', '正交折线'], ['smoothstep', '圆角折线'], ['curve', '曲线'], ['polyline', '手动折线']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {(['startMarker', 'endMarker'] as const).map((key) => <label key={key}>{key === 'startMarker' ? '起点箭头' : '终点箭头'}<select value={edge.data?.[key] ?? (key === 'endMarker' ? 'closed-arrow' : 'none')} onChange={(e) => updateEdge({ [key]: e.target.value })}><option value="none">无</option><option value="arrow">开放箭头</option><option value="closed-arrow">实心箭头</option></select></label>)}
      <div className="flow-field-row"><label>连接线颜色<input type="color" value={edge.data?.stroke ?? '#66778c'} onChange={(e) => updateEdge({ stroke: e.target.value })} /></label><label>连接线宽<input type="number" min={1} max={12} value={edge.data?.strokeWidth ?? 2} onChange={(e) => updateEdge({ strokeWidth: Math.max(1, Math.min(12, Number(e.target.value) || 2)) })} /></label></div>
      <label><input type="checkbox" checked={Boolean(edge.data?.dashed)} onChange={(e) => updateEdge({ dashed: e.target.checked })} />虚线连接</label>
      <button onClick={() => updateEdge({ waypoints: [] })}>重置控制点</button><p className="flow-help">拖动端点重新连接。双击连线添加控制点，拖动调整；双击控制点删除。</p>
    </> : <p className="flow-help">选择图形或连接线以编辑属性。Shift 多选；拖动空白处框选。</p>}
  </div>;
}
