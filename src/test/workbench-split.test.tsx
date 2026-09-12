import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchSplit } from '@/components/shared/WorkbenchSplit';

function Dropzone() {
  return <div data-dropzone>拖入文件</div>;
}
Dropzone.displayName = 'FileDropzone';

describe('WorkbenchSplit', () => {
  it('空态只保留预览舞台，不渲染属性栏操作', () => {
    render(
      <WorkbenchSplit empty emptyFooter={<span>识别语言</span>}>
        <Dropzone />
        <button type="button">开始处理</button>
      </WorkbenchSplit>
    );

    expect(screen.getByText('拖入文件')).toBeInTheDocument();
    expect(screen.getByText('识别语言')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始处理' })).not.toBeInTheDocument();
  });

  it('有内容时恢复预览和属性分栏', () => {
    render(
      <WorkbenchSplit>
        <Dropzone />
        <button type="button">开始处理</button>
      </WorkbenchSplit>
    );

    expect(screen.getByText('拖入文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始处理' })).toBeInTheDocument();
  });
});
