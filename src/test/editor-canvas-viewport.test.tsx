import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorCanvas } from '@/tools/graphic/screenshot/EditorCanvas';

let stageProps: Record<string, unknown> = {};

vi.mock('react-konva', async () => {
  const React = await import('react');
  const Component = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Stage = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    stageProps = props;
    return <div ref={ref} data-testid="konva-stage">{props.children as React.ReactNode}</div>;
  });
  Stage.displayName = 'Stage';
  return {
    Stage,
    Layer: Component,
    Image: Component,
    Rect: Component,
    Ellipse: Component,
    Line: Component,
    Arrow: Component,
    Text: Component,
    Transformer: Component,
    Group: Component,
  };
});

vi.mock('@/tools/graphic/screenshot/HistoryProvider', () => ({
  useHistory: () => ({ execute: vi.fn() }),
}));

describe('EditorCanvas viewport', () => {
  beforeEach(() => {
    stageProps = {};
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
  });

  it('allows the image viewport to be moved by dragging the stage', () => {
    render(
      <EditorCanvas
        image={new Image()}
        canvasSize={{ width: 2_000, height: 8_000 }}
        tool="select"
        settings={{ color: '#f00', strokeWidth: 2, fontSize: 20, opacity: 0.5, filled: false, fillColor: '#f00' }}
        annotations={[]}
        selectedIds={[]}
        numberCounter={1}
        onAnnotationsChange={vi.fn()}
        onSelectChange={vi.fn()}
        onNumberCounterChange={vi.fn()}
        stageRef={{ current: null }}
      />,
    );

    expect(screen.getByTestId('konva-stage')).toBeInTheDocument();
    expect(stageProps.draggable).toBe(true);
  });
});
