import { DiagramEditor } from './diagram-editor';
import { renderPlantUmlDiagram, renderPlantUmlPng } from './plantuml-renderer';

const renderer = { render: renderPlantUmlDiagram, renderPng: renderPlantUmlPng };

export default function PlantUmlEditor() {
  return <DiagramEditor kind="plantuml" renderer={renderer} />;
}
