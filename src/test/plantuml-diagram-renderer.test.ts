import { describe, expect, it, vi } from 'vitest';
import { renderPlantUmlDiagram, renderPlantUmlPng } from '@/tools/diagram/plantuml-renderer';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('PlantUML diagram renderer', () => {
  it('asks the local Tauri command for SVG without a network transport', async () => {
    invoke.mockResolvedValueOnce(Array.from(new TextEncoder().encode('<svg>local</svg>')));

    await expect(renderPlantUmlDiagram('@startuml\n@enduml', { scheme: 'dark' })).resolves.toEqual({ svg: '<svg>local</svg>' });
    expect(invoke).toHaveBeenCalledWith('render_plantuml', {
      source: '@startuml\n@enduml',
      scheme: 'dark',
      format: 'svg',
    });
  });

  it('requests native PNG bytes only when PNG export is selected', async () => {
    invoke.mockResolvedValueOnce([137, 80, 78, 71]);

    await expect(renderPlantUmlPng('@startuml\n@enduml', { scheme: 'light' })).resolves.toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(invoke).toHaveBeenLastCalledWith('render_plantuml', expect.objectContaining({ format: 'png' }));
  });
});
