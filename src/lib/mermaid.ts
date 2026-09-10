let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

/**
 * Mermaid 11 把 ZenUML 拆成了外部图类型。编辑器和 Markdown 预览共用这一次注册，
 * 否则以 `zenuml` 开头的源码会直接变成 UnknownDiagramError。
 */
export async function getMermaid() {
  mermaidPromise ??= (async () => {
    const [{ default: mermaid }, { default: zenuml }] = await Promise.all([
      import('mermaid'),
      import('@mermaid-js/mermaid-zenuml'),
    ]);
    await mermaid.registerExternalDiagrams([zenuml]);
    return mermaid;
  })();
  return mermaidPromise;
}
