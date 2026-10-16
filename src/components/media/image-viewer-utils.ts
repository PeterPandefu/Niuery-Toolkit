export const IMAGE_VIEWER_MIN_ZOOM = 0.25;
export const IMAGE_VIEWER_MAX_ZOOM = Number.POSITIVE_INFINITY;
export const IMAGE_VIEWER_ZOOM_STEP = 0.25;

export function clampImageViewerZoom(value: number): number {
  return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, value));
}
