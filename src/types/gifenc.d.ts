declare module 'gifenc' {
  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: Record<string, unknown>): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: Uint8Array, maxColors: number, options?: Record<string, unknown>): number[][];
  export function applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array;
}
