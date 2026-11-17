const MEDIA_TOOLS = new Set(['generate_image', 'generate_video', 'generate_video_from_image']);

/** Rust media tools report success in a fixed wording; the saved path is
 *  extracted from it so the result renders as a real preview. Keep the format
 *  in src-tauri tools/media.rs in sync with this pattern. */
export function mediaResultPath(toolName: string, result: unknown, isError?: boolean): string | undefined {
  if (isError || !MEDIA_TOOLS.has(toolName) || typeof result !== 'string') return undefined;
  return result.match(/已生成(?:图像|视频)并保存到\s+(.+?)（\d+ 字节）/)?.[1];
}