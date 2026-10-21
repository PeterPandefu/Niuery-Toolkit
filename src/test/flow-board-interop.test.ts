import { describe, expect, it } from 'vitest';
import { flowToMermaid, parseCsvFlowchart, parseMermaidFlowchart, parseSqlFlowchart } from '@/tools/graphic/flow-board/interop';

describe('flow board interoperability', () => {
  it('parses Mermaid flowcharts into editable nodes and labeled edges', () => {
    const document = parseMermaidFlowchart('flowchart LR\nA[开始] -->|是| B{判断}\nB --> C[结束]');
    expect(document.nodes.map((node) => node.data.label)).toEqual(['开始', '判断', '结束']);
    expect(document.nodes[1].data.semanticType).toBe('decision');
    expect(document.edges[0].data?.label).toBe('是');
  });

  it('parses CSV node and edge columns', () => {
    const document = parseCsvFlowchart('id,label,source,target\na,开始,,b\nb,结束,a,b');
    expect(document.nodes.map((node) => node.data.label)).toContain('开始');
    expect(document.edges).toHaveLength(1);
  });

  it('exports the current page as editable Mermaid source', () => {
    const document = parseMermaidFlowchart('flowchart LR\nA[开始] --> B[结束]');
    const source = flowToMermaid(document);
    expect(source).toContain('flowchart LR');
    expect(source).toContain('A --> B');
  });

  it('parses SQL tables and foreign keys into database nodes and edges', () => {
    const document = parseSqlFlowchart('CREATE TABLE users (id INT PRIMARY KEY); CREATE TABLE orders (id INT, user_id INT, FOREIGN KEY (user_id) REFERENCES users(id));');
    expect(document.nodes).toHaveLength(2);
    expect(document.nodes[1].data.semanticType).toBe('database');
    expect(document.edges).toHaveLength(1);
    expect(document.edges[0].target).toBe('users');
  });
});
