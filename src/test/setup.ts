import '@testing-library/jest-dom';

// jsdom has no layout observers; real WebView/Chromium provides these APIs.
if (typeof window !== 'undefined' && !globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (typeof window !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? this.scrollTop; };
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
