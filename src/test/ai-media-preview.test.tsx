import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import i18n from '@/i18n';
import { AiToolCallPart } from '@/tools/ai-assistant/runtime/tool-call-part';
import { mediaResultPath } from '@/tools/ai-assistant/runtime/media-result';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`,
}));

beforeEach(async () => { await i18n.changeLanguage('zh'); });
afterEach(cleanup);

function partProps(partial: Partial<ToolCallMessagePartProps>): ToolCallMessagePartProps {
  return partial as ToolCallMessagePartProps;
}

describe('AiToolCallPart media preview', () => {
  it('renders a generated image inline without expanding the card', () => {
    render(<AiToolCallPart {...partProps({ toolName: 'generate_image', argsText: '{}', result: '已生成图像并保存到 C:/Users/me/Pictures/cat.png（123 字节）。', isError: false })} />);
    const img = screen.getByAltText('生成的图像');
    expect(img.getAttribute('src')).toContain('cat.png');
  });

  it('renders a generated video with playback controls', () => {
    render(<AiToolCallPart {...partProps({ toolName: 'generate_video_from_image', argsText: '{}', result: '已生成视频并保存到 C:/temp/out.mp4（456 字节）。', isError: false })} />);
    const video = screen.getByLabelText('生成的视频');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toContain('out.mp4');
  });

  it('shows no preview for failed calls', () => {
    render(<AiToolCallPart {...partProps({ toolName: 'generate_image', argsText: '{}', result: '图像服务返回 HTTP 400，未生成图片。', isError: true })} />);
    expect(screen.queryByAltText('生成的图像')).toBeNull();
  });
});

describe('mediaResultPath', () => {
  it('extracts the saved path from image and video success results', () => {
    expect(mediaResultPath('generate_image', '已生成图像并保存到 C:/Users/me/Pictures/cat.png（12345 字节）。'))
      .toBe('C:/Users/me/Pictures/cat.png');
    expect(mediaResultPath('generate_video', '已生成视频并保存到 D:/我的 视频/out.mp4（987654 字节）。'))
      .toBe('D:/我的 视频/out.mp4');
    expect(mediaResultPath('generate_video_from_image', '已生成视频并保存到 C:/temp/i2v.mp4（100 字节）。'))
      .toBe('C:/temp/i2v.mp4');
  });

  it('ignores errors, other tools and malformed results', () => {
    expect(mediaResultPath('generate_image', '已生成图像并保存到 C:/x.png（1 字节）。', true)).toBeUndefined();
    expect(mediaResultPath('write_local_file', '已生成图像并保存到 C:/x.png（1 字节）。')).toBeUndefined();
    expect(mediaResultPath('generate_image', '图像服务返回 HTTP 400，未生成图片。')).toBeUndefined();
    expect(mediaResultPath('generate_video', undefined)).toBeUndefined();
    expect(mediaResultPath('generate_video', { path: 'C:/x.mp4' })).toBeUndefined();
  });
});