declare module 'simple-mind-map' {
  export interface MindMapData {
    root: MindMapNode;
    layout?: string;
    theme?: { template?: string; config?: Record<string, unknown> };
    view?: Record<string, unknown>;
  }

  export interface MindMapNode {
    data: Record<string, unknown> & { text: string; note?: string; hyperlink?: string };
    children: MindMapNode[];
  }

  export interface MindMapInstance {
    on(event: string, callback: (...args: unknown[]) => void): void;
    off(event: string, callback: (...args: unknown[]) => void): void;
    getData(withConfig?: boolean): MindMapData;
    setFullData(data: MindMapData): void;
    execCommand(command: string, ...args: unknown[]): void;
    export(type: string, isDownload?: boolean, name?: string, ...args: unknown[]): Promise<string | null>;
    view: { fit: () => void };
    search?: MindMapSearch;
    destroy: () => void;
  }

  export interface MindMapSearch {
    search: (text: string | undefined, callback?: () => void) => void;
    searchNext: (callback?: () => void, index?: number) => void;
    jump: (index: number, callback?: () => void) => void;
    endSearch: () => void;
  }

  class MindMap {
    constructor(options: Record<string, unknown>);
    static usePlugin(plugin: unknown, options?: Record<string, unknown>): typeof MindMap;
  }

  export default MindMap;
}

declare module 'simple-mind-map/src/plugins/Export' {
  const ExportPlugin: unknown;
  export default ExportPlugin;
}

declare module 'simple-mind-map/src/plugins/Search' {
  const SearchPlugin: unknown;
  export default SearchPlugin;
}

declare module 'simple-mind-map/src/plugins/KeyboardNavigation' {
  const KeyboardNavigationPlugin: unknown;
  export default KeyboardNavigationPlugin;
}
