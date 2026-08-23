import { DiagramEditor } from './diagram-editor';
import { renderMermaidDiagram } from './mermaid-renderer';

const renderer = { render: renderMermaidDiagram };

export default function MermaidEditor() {
  return <DiagramEditor kind="mermaid" renderer={renderer} />;
}
