import { useContext, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, Position, useNodes, useReactFlow, type EdgeProps, type NodeProps } from '@xyflow/react';
import { getEdgeGeometry, getNodeShape } from './geometry';
import type { FlowEdge, FlowNode, FlowPoint } from './types';
import { CanvasActionsContext } from './canvas-context';
const sides = [Position.Left, Position.Top, Position.Right, Position.Bottom];

/** SVG outline and text layout are shared with the file exporter. */
export function FlowNodeView({ id, data, selected, isConnectable, width, height }: NodeProps<FlowNode>) {
  const actions = useContext(CanvasActionsContext)!;
  const [editing, setEditing] = useState(false);
  const viewData = { ...data, width: width && width > 0 ? width : data.width, height: height && height > 0 ? height : data.height };
  const shape = getNodeShape(viewData);
  const container = Boolean(data.containerType);
  return <div className={`flow-node${selected ? ' is-selected' : ''}${container ? ' flow-container' : ''}`} style={{ width: viewData.width, height: viewData.height }} onDoubleClick={(event) => { event.stopPropagation(); actions.begin(); setEditing(true); }}>
    <NodeResizer isVisible={selected && isConnectable} minWidth={container ? 160 : 40} minHeight={container ? 100 : 30}
      onResizeStart={actions.begin} onResize={(_, size) => actions.updateNode(id, { width: size.width, height: size.height })} onResizeEnd={actions.finish} />
    <svg className="flow-node-outline" width={viewData.width} height={viewData.height} viewBox={`0 0 ${viewData.width} ${viewData.height}`} aria-hidden="true">
      {shape.paths.map((path, index) => <path key={index} d={path} fill={index === 0 && shape.fill ? data.fill : 'none'} stroke={data.stroke} strokeWidth={data.strokeWidth ?? 2} strokeDasharray={data.dashed ? '6 4' : undefined} />)}
    </svg>
    {editing ? <textarea autoFocus aria-label="编辑节点文本" className="flow-node-edit nodrag nowheel" value={data.label}
      onChange={(event) => actions.updateNode(id, { label: event.target.value })}
      onBlur={() => { setEditing(false); actions.finish(); }}
      onKeyDown={(event) => { if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) event.currentTarget.blur(); }} />
      : <span className="flow-node-label" style={{ fontSize: data.fontSize ?? 14, fontWeight: data.bold ? 700 : 400, fontStyle: data.italic ? 'italic' : 'normal', textAlign: data.textAlign ?? 'center', color: data.textColor, height: container ? 32 : '100%' }}>{data.label}</span>}
    {!container && sides.map((position) => <Handle key={position} type="source" position={position} id={position} isConnectable={isConnectable} />)}
  </div>;
}

export function FlowEdgeView(props: EdgeProps<FlowEdge>) {
  const actions = useContext(CanvasActionsContext)!;
  const nodes = useNodes<FlowNode>();
  const { screenToFlowPosition } = useReactFlow();
  const edge: FlowEdge = { ...props, id: props.id, source: props.source, target: props.target, sourceHandle: props.sourceHandleId, targetHandle: props.targetHandleId };
  const geometry = getEdgeGeometry(nodes, edge);
  const points = props.data?.waypoints ?? [];
  const dragPoint = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); actions.begin();
    const initial = [...points];
    const move = (e: PointerEvent) => {
      const next = [...initial]; next[index] = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      actions.updateEdge(props.id, { waypoints: next });
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); actions.finish(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
  };
  const addWaypoint = (event: React.MouseEvent) => {
    const point: FlowPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    actions.begin(); actions.updateEdge(props.id, { waypoints: [...points, point], routing: 'polyline' }); actions.finish();
  };
  return <>
    <g onDoubleClick={addWaypoint}>
      <BaseEdge id={props.id} path={geometry.path} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={20} style={{ stroke: props.data?.stroke ?? '#66778c', strokeWidth: props.data?.strokeWidth ?? 2, strokeDasharray: props.data?.dashed ? '6 4' : undefined }} />
    </g>
    <EdgeLabelRenderer>
      {props.data?.label && <div className="flow-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${geometry.label.x}px,${geometry.label.y}px)` }}>{props.data.label}</div>}
      {props.selected && points.map((point, index) => <button key={index} title="拖动控制点；双击删除" aria-label={`控制点 ${index + 1}`} className="flow-edge-waypoint nodrag nopan"
        style={{ transform: `translate(-50%, -50%) translate(${point.x}px,${point.y}px)` }} onPointerDown={(event) => dragPoint(index, event)}
        onDoubleClick={() => { actions.begin(); actions.updateEdge(props.id, { waypoints: points.filter((_, i) => i !== index) }); actions.finish(); }} />)}
    </EdgeLabelRenderer>
  </>;
}
