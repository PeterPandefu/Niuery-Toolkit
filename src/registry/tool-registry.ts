import { lazy } from 'react';
import { TOOL_CATEGORY_ORDER, ToolDefinition, ToolCategory, ToolCapabilities } from '@/types/tool';
import {
  ArrowLeftRight,
  Binary,
  Braces,
  Camera,
  ClipboardList,
  Clock,
  Code2,
  Compass,
  FileCode2,
  FileDigit,
  FileJson,
  FileStack,
  FileText,
  Fingerprint,
  Globe,
  Hash,
  ImagePlus,
  KeyRound,
  Languages,
  Link2,
  MapPinned,
  Paintbrush,
  Palette,
  QrCode,
  Regex,
  Shield,
  ShieldCheck,
  Shuffle,
  StickyNote,
  Square,
  Type,
  Video,
  Wind,
  Activity,
  FileLock2,
  Network,
  Workflow,
  PenTool,
} from 'lucide-react';

// 工具注册表
const toolRegistry = new Map<string, ToolDefinition>();
const preloadPromises = new Map<string, Promise<unknown>>();

const TOOL_CAPABILITIES: Partial<Record<string, ToolCapabilities>> = {
  'sticky-note': { network: 'offline', permissions: ['file', 'nativeWindow'], desktopOnly: true },
  'clipboard-history': { network: 'offline', permissions: ['clipboard'], desktopOnly: true },
  'image-studio': { network: 'offline', permissions: ['file', 'clipboard'] },
  'mind-map': { network: 'offline', permissions: ['file'] },
  'excalidraw-board': { network: 'offline', permissions: ['file'] },
  'tldraw-board': { network: 'offline', permissions: ['file'] },
  'screenshot-editor': { network: 'offline', permissions: ['file', 'clipboard', 'screen'] },
  'screen-recorder': { network: 'offline', permissions: ['file', 'screen', 'microphone', 'systemAudio'], desktopOnly: true },
  'system-monitor': { network: 'offline', permissions: ['system'], desktopOnly: true },
  'port-process-killer': { network: 'offline', permissions: ['system'], desktopOnly: true },
  'file-unlocker': { network: 'offline', permissions: ['file', 'system'], desktopOnly: true },
  'socket-tool': { network: 'hybrid', permissions: ['localNetwork'], desktopOnly: true },
  'api-tester': { network: 'network', permissions: [] },
  translator: { network: 'network', permissions: [] },
};

function resolveCapabilities(tool: Omit<ToolDefinition, 'capabilities'>): ToolCapabilities {
  return TOOL_CAPABILITIES[tool.id] ?? {
    network: tool.category === 'network' || tool.category === 'language' ? 'network' : 'offline',
    permissions: [],
  };
}

// 注册工具函数
export function registerTool(tool: Omit<ToolDefinition, 'capabilities'> & { capabilities?: ToolCapabilities }) {
  toolRegistry.set(tool.id, { ...tool, capabilities: tool.capabilities ?? resolveCapabilities(tool) });
}

// 获取所有工具
export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

// 按分类获取工具
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return getAllTools().filter((tool) => tool.category === category);
}

// 根据ID获取工具
export function getToolById(id: string): ToolDefinition | undefined {
  return toolRegistry.get(id);
}

/** 在用户明确指向工具后预加载其代码；失败不影响正常点击加载。 */
export function preloadTool(id: string) {
  const preload = getToolById(id)?.preload;
  if (!preload) return;
  const existing = preloadPromises.get(id);
  if (existing) return;
  const pending = preload().catch((error) => {
    preloadPromises.delete(id);
    throw error;
  });
  preloadPromises.set(id, pending);
  void pending.catch(() => undefined);
}

// 获取所有分类（有工具的）
export function getAvailableCategories(): ToolCategory[] {
  const categories = new Set(getAllTools().map((tool) => tool.category));
  return TOOL_CATEGORY_ORDER.filter((category) => categories.has(category));
}

// ==================== 注册所有工具 ====================

// === 转换器 ===
registerTool({
  id: 'json-yaml',
  name: 'JSON ↔ YAML',
  icon: ArrowLeftRight,
  category: 'data',
  component: lazy(() => import('@/tools/converter/json-yaml')),
  keywords: ['json', 'yaml', 'yml', '转换', 'convert'],
  description: 'JSON 与 YAML 双向实时转换',
});

registerTool({
  id: 'xml-json',
  name: 'XML ↔ JSON',
  icon: FileCode2,
  category: 'data',
  component: lazy(() => import('@/tools/converter/xml-json')),
  keywords: ['xml', 'json', '转换', 'convert'],
  description: 'XML 与 JSON 双向转换',
});

registerTool({
  id: 'timestamp',
  name: '时间戳转换',
  icon: Clock,
  category: 'data',
  component: lazy(() => import('@/tools/converter/timestamp')),
  keywords: ['timestamp', 'unix', '时间', '日期', 'date', 'time'],
  description: 'Unix 时间戳与日期互转',
});

registerTool({
  id: 'number-base',
  name: '进制转换',
  icon: Binary,
  category: 'data',
  component: lazy(() => import('@/tools/converter/number-base')),
  keywords: ['binary', 'hex', 'octal', 'decimal', '进制', '二进制', '十六进制'],
  description: '二/八/十/十六进制互转',
});

registerTool({
  id: 'color-picker',
  name: '颜色与取色',
  icon: Palette,
  category: 'data',
  component: lazy(() => import('@/tools/converter/color-assistant')),
  keywords: ['color', 'hex', 'rgb', 'hsl', '颜色', '取色', '色卡', '渐变', '传统色', 'palette', 'gradient'],
  description: '颜色选择、UI色卡、传统色、渐变色、图片取色',
});

registerTool({
  id: 'data-size',
  name: '数据单位换算',
  icon: FileDigit,
  category: 'data',
  component: lazy(() => import('@/tools/converter/data-size')),
  keywords: ['byte', 'kb', 'mb', 'gb', '数据', '大小', 'size'],
  description: 'B/KB/MB/GB/TB 数据大小互转',
});

registerTool({
  id: 'angle',
  name: '角度转换',
  icon: Compass,
  category: 'data',
  component: lazy(() => import('@/tools/converter/angle')),
  keywords: ['angle', 'degree', 'radian', 'grad', '角度', '弧度'],
  description: '度/弧度/梯度互转',
});

registerTool({
  id: 'province-lookup',
  name: '坐标归属查询',
  icon: MapPinned,
  category: 'data',
  component: lazy(() => import('@/tools/converter/province-lookup')),
  keywords: [
    'province',
    'longitude',
    'latitude',
    '经纬度',
    '省份',
    '行政区',
    'geo',
    '坐标',
    'gcj02',
    'wgs84',
  ],
  description: '根据经纬度离线查询所属中国省级行政区',
});

// === 编码器/解码器 ===
registerTool({
  id: 'base64',
  name: 'Base64',
  icon: Code2,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/base64')),
  keywords: ['base64', 'encode', 'decode', '编码', '解码'],
  description: '文本/文件 Base64 编解码',
});

registerTool({
  id: 'url-encode',
  name: 'URL 编解码',
  icon: Link2,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/url-encode')),
  keywords: ['url', 'uri', 'encode', 'decode', '编码', '解码', 'percent'],
  description: 'URL 组件编解码',
});

registerTool({
  id: 'html-entity',
  name: 'HTML 实体',
  icon: FileText,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/html-entity')),
  keywords: ['html', 'entity', '实体', '转义', 'escape'],
  description: 'HTML 实体编解码',
});

registerTool({
  id: 'unicode',
  name: 'Unicode 转义',
  icon: Type,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/unicode')),
  keywords: ['unicode', 'utf', '转义', 'escape', '\\u'],
  description: 'Unicode 转义/反转义',
});

registerTool({
  id: 'jwt-decoder',
  name: 'JWT 解析器',
  icon: Shield,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/jwt-decoder')),
  keywords: ['jwt', 'token', 'json web token', '解析'],
  description: 'JWT 令牌解析与验证',
});

registerTool({
  id: 'qrcode',
  name: '二维码生成与识别',
  icon: QrCode,
  category: 'generator',
  component: lazy(() => import('@/tools/encoder/qrcode')),
  keywords: ['qr', 'qrcode', '二维码', '扫码'],
  description: '文本与二维码互转',
});

registerTool({
  id: 'gzip',
  name: 'GZip 压缩',
  icon: Wind,
  category: 'security',
  component: lazy(() => import('@/tools/encoder/gzip')),
  keywords: ['gzip', 'deflate', 'compress', '压缩', '解压', 'decompress'],
  description: 'GZip/Deflate 压缩解压',
});

// === 格式化器 ===
registerTool({
  id: 'json-formatter',
  name: 'JSON 格式化',
  icon: FileJson,
  category: 'data',
  component: lazy(() => import('@/tools/formatter/json-formatter')),
  keywords: ['json', 'format', 'beautify', '格式化', '美化'],
  description: 'JSON 美化/压缩/校验',
});

registerTool({
  id: 'xml-formatter',
  name: 'XML 格式化',
  icon: FileCode2,
  category: 'data',
  component: lazy(() => import('@/tools/formatter/xml-formatter')),
  keywords: ['xml', 'format', 'beautify', '格式化', '美化'],
  description: 'XML 美化/压缩',
});

registerTool({
  id: 'sql-formatter',
  name: 'SQL 格式化',
  icon: Braces,
  category: 'data',
  component: lazy(() => import('@/tools/formatter/sql-formatter')),
  keywords: ['sql', 'mysql', 'postgres', 'format', '格式化', '查询'],
  description: 'SQL 查询美化',
});

registerTool({
  id: 'markdown-editor',
  name: 'Markdown 编辑器',
  icon: FileText,
  category: 'text',
  component: lazy(() => import('@/tools/formatter/markdown-editor')),
  preload: () => import('@/tools/formatter/markdown-editor'),
  keywords: ['markdown', 'md', 'editor', 'preview', '编辑', '预览', '渲染', '写作'],
  description: 'Markdown 编辑器：实时预览、工具栏、导出',
});

registerTool({
  id: 'html-renderer',
  name: 'HTML 离线渲染器',
  icon: Globe,
  category: 'text',
  component: lazy(() => import('@/tools/formatter/html-renderer')),
  preload: () => import('@/tools/formatter/html-renderer'),
  keywords: ['html', 'preview', 'pdf', 'png', 'screenshot', '离线', '预览', '渲染'],
  description: 'HTML 本地预览与 Chromium 高质量 PDF/PNG 导出',
});

registerTool({
  id: 'report-generator',
  name: '数据报告生成器',
  icon: FileText,
  category: 'data',
  component: lazy(() => import('@/tools/formatter/report-generator')),
  keywords: ['json', 'report', 'table', 'pdf', 'png', '报告', '表格', '导出'],
  description: 'JSON 数据表格的离线预览与 PDF/PNG 导出',
});

registerTool({
  id: 'mermaid-editor',
  name: 'Mermaid 实时编辑器',
  icon: Workflow,
  category: 'text',
  component: lazy(() => import('@/tools/diagram/mermaid-editor')),
  preload: () => import('@/tools/diagram/mermaid-editor'),
  keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', '图表', '流程图', '实时预览'],
  description: 'Mermaid 图表实时编辑、预览与 PNG/SVG 导出',
});

registerTool({
  id: 'plantuml-editor',
  name: 'PlantUML 实时编辑器',
  icon: Code2,
  category: 'text',
  component: lazy(() => import('@/tools/diagram/plantuml-editor')),
  preload: () => import('@/tools/diagram/plantuml-editor'),
  keywords: ['plantuml', 'uml', 'diagram', 'sequence', 'class', '图表', '时序图', '实时预览'],
  description: '本地离线 PlantUML 编辑、预览与 PNG/SVG 导出',
});

registerTool({
  id: 'sticky-note',
  name: '悬浮便签',
  icon: StickyNote,
  category: 'text',
  component: lazy(() => import('@/tools/text/sticky-note')),
  keywords: ['sticky note', 'note', 'memo', '便签', '记事', '悬浮', '桌面'],
  description: '独立桌面悬浮便签，支持快捷键唤出与自动保存',
});

// === 生成器 ===
registerTool({
  id: 'uuid-generator',
  name: 'UUID 与随机 ID',
  icon: Fingerprint,
  category: 'generator',
  component: lazy(() => import('@/tools/generator/uuid-generator')),
  keywords: ['uuid', 'guid', 'ulid', 'nanoid', '生成'],
  description: 'UUID v1/v4/v5/ULID/NanoID 生成',
});

registerTool({
  id: 'hash-generator',
  name: '哈希计算',
  icon: Hash,
  category: 'security',
  component: lazy(() => import('@/tools/generator/hash-generator')),
  keywords: ['hash', 'md5', 'sha', 'sha256', 'sha512', '哈希', '校验'],
  description: 'MD5/SHA1/SHA256/SHA512 哈希计算',
});

registerTool({
  id: 'password-generator',
  name: '密码生成器',
  icon: KeyRound,
  category: 'security',
  component: lazy(() => import('@/tools/generator/password-generator')),
  keywords: ['password', '密码', '随机', '安全'],
  description: '安全密码生成',
});

registerTool({
  id: 'lorem-ipsum',
  name: 'Lorem Ipsum',
  icon: FileText,
  category: 'generator',
  component: lazy(() => import('@/tools/generator/lorem-ipsum')),
  keywords: ['lorem', 'ipsum', 'placeholder', '占位', '文本'],
  description: '占位文本生成',
});

registerTool({
  id: 'checksum',
  name: '文件校验和',
  icon: ShieldCheck,
  category: 'security',
  component: lazy(() => import('@/tools/generator/checksum')),
  keywords: ['checksum', 'hash', 'file', '校验', '文件', 'md5', 'sha'],
  description: '文件校验和计算',
});

// === 文本工具 ===
registerTool({
  id: 'text-diff',
  name: '文本对比',
  icon: Shuffle,
  category: 'text',
  component: lazy(() => import('@/tools/text/text-diff')),
  keywords: ['diff', 'compare', '对比', '比较', '差异'],
  description: '两段文本差异比对',
});

registerTool({
  id: 'regex-tester',
  name: '正则测试',
  icon: Regex,
  category: 'text',
  component: lazy(() => import('@/tools/text/regex-tester')),
  keywords: ['regex', 'regexp', '正则', '匹配', 'pattern'],
  description: '正则表达式测试',
});

registerTool({
  id: 'case-converter',
  name: '大小写转换',
  icon: Type,
  category: 'text',
  component: lazy(() => import('@/tools/text/case-converter')),
  keywords: ['case', 'camel', 'snake', 'kebab', '大小写', '命名'],
  description: '命名风格转换',
});

registerTool({
  id: 'text-inspector',
  name: '文本分析',
  icon: FileText,
  category: 'text',
  component: lazy(() => import('@/tools/text/text-inspector')),
  keywords: ['text', 'count', '字数', '统计', '字符'],
  description: '字符统计分析',
});

registerTool({
  id: 'escape-unescape',
  name: '转义处理',
  icon: Code2,
  category: 'text',
  component: lazy(() => import('@/tools/text/escape-unescape')),
  keywords: ['escape', 'unescape', '转义', '反转义'],
  description: '字符串转义处理',
});

registerTool({
  id: 'clipboard-history',
  name: '剪贴板历史记录',
  icon: ClipboardList,
  category: 'system',
  component: lazy(() => import('@/tools/text/clipboard-history')),
  keywords: ['clipboard', 'paste', 'copy', 'history', '粘贴板', '剪贴板', '复制', '历史', '记录'],
  description: '剪贴板历史记录与重新复制',
});

// === 图形工具 ===
registerTool({
  id: 'image-studio',
  name: '图片工作室',
  icon: ImagePlus,
  category: 'image',
  component: lazy(() => import('@/tools/graphic/image-studio')),
  keywords: ['image', 'compress', 'convert', 'resize', 'watermark', 'crop', 'rotate', 'gif', 'pdf', '图片', '压缩', '转换', '尺寸', '水印', '圆角', '裁剪', '旋转', '翻转', '合并'],
  description: '图片压缩/转换/尺寸/水印/圆角/裁剪/旋转/合并等一站式处理',
});

registerTool({
  id: 'mind-map',
  name: '思维导图',
  icon: Workflow,
  category: 'canvas',
  component: lazy(() => import('@/tools/graphic/mind-map')),
  keywords: ['mind map', 'mind-map', '思维导图', '大纲', 'markdown', 'smm', '离线'],
  description: '离线思维导图：支持 .smm、XMind、Markdown 导入与 PNG/SVG 导出',
});

registerTool({
  id: 'excalidraw-board',
  name: 'Excalidraw 白板',
  icon: PenTool,
  category: 'canvas',
  component: lazy(() => import('@/tools/graphic/excalidraw-board')),
  preload: () => import('@/tools/graphic/excalidraw-board'),
  keywords: ['excalidraw', 'whiteboard', 'board', '白板', '画布', '绘图', '离线'],
  description: '离线 Excalidraw 无限白板：本地保存、打开与 PNG/SVG 导出',
});

registerTool({
  id: 'tldraw-board',
  name: 'Tldraw 白板',
  icon: PenTool,
  category: 'canvas',
  component: lazy(() => import('@/tools/graphic/tldraw-board')),
  preload: () => import('@/tools/graphic/tldraw-board'),
  keywords: ['tldraw', 'whiteboard', 'board', '白板', '画布', '绘图', '离线'],
  description: '离线 Tldraw 无限白板：本地 .tldr 保存、打开与 SVG 导出',
});

registerTool({
  id: 'svg-optimizer',
  name: 'SVG 优化',
  icon: Paintbrush,
  category: 'image',
  component: lazy(() => import('@/tools/graphic/svg-optimizer')),
  keywords: ['svg', 'optimize', '优化', '矢量'],
  description: 'SVG 精简优化',
});

registerTool({
  id: 'icon-generator',
  name: '应用图标生成',
  icon: Square,
  category: 'generator',
  component: lazy(() => import('@/tools/graphic/icon-generator')),
  keywords: ['icon', 'favicon', '图标', '生成', 'app', 'ios', 'android'],
  description: '从图片生成应用图标',
});

registerTool({
  id: 'screenshot-editor',
  name: '截图与标注',
  icon: Camera,
  category: 'capture',
  component: lazy(() => import('@/tools/graphic/screenshot-editor')),
  keywords: ['screenshot', 'capture', 'annotate', '截图', '截屏', '标注', '编辑'],
  description: '屏幕截图捕获与标注编辑',
});

registerTool({
  id: 'screen-recorder',
  name: '屏幕录制',
  icon: Video,
  category: 'capture',
  component: lazy(() => import('@/tools/graphic/screen-recorder')),
  keywords: ['screen', 'record', 'video', 'gif', '录屏', '录制', '窗口录制', '动图'],
  description: '区域、窗口与显示器录制，并支持 GIF 编辑导出',
});

registerTool({
  id: 'system-monitor',
  name: '系统监控',
  icon: Activity,
  category: 'system',
  component: lazy(() => import('@/tools/system/system-monitor')),
  keywords: ['system', 'monitor', 'cpu', 'memory', 'ram', 'network', '系统', '监控', '内存', '网络'],
  description: '实时查看 CPU、内存和网络资源使用情况',
});

registerTool({
  id: 'port-process-killer',
  name: '端口进程终止',
  icon: Network,
  category: 'system',
  component: lazy(() => import('@/tools/system/port-process-killer')),
  keywords: ['port', 'process', 'kill', 'tcp', 'udp', '端口', '进程', '结束', '占用'],
  description: '查找并结束占用指定本地端口的进程',
});

registerTool({
  id: 'file-unlocker',
  name: '文件占用解除',
  icon: FileLock2,
  category: 'system',
  component: lazy(() => import('@/tools/system/file-unlocker')),
  keywords: ['file', 'unlock', 'lock', 'process', '文件', '占用', '解锁', '进程'],
  description: '查找并关闭占用指定文件的进程',
});

// === 网络工具 ===
registerTool({
  id: 'socket-tool',
  name: 'WebSocket 调试',
  icon: Globe,
  category: 'network',
  component: lazy(() => import('@/tools/network/socket-tool')),
  keywords: ['socket', 'websocket', 'ws', '网络', '连接', 'server', 'client', '调试'],
  description: 'WebSocket 客户端/服务端调试',
});

// === 网络工具 ===
registerTool({
  id: 'api-tester',
  name: 'HTTP API 调试',
  icon: Globe,
  category: 'network',
  component: lazy(() => import('@/tools/network/api-tester')),
  keywords: ['api', 'http', 'rest', 'request', 'response', '接口', '请求', '调试', 'postman', 'apifox'],
  description: 'HTTP API 接口调试测试',
});

// === 翻译工具 ===
registerTool({
  id: 'translator',
  name: '多语言翻译',
  icon: Languages,
  category: 'language',
  component: lazy(() => import('@/tools/translate')),
  keywords: ['translate', 'translation', 'baidu', 'language', '翻译', '译文', '语言'],
  description: '百度翻译：多语种互译，自动检测源语言',
});

// === PDF 工具 ===
registerTool({
  id: 'pdf-toolkit',
  name: 'PDF 处理',
  icon: FileStack,
  category: 'image',
  component: lazy(() => import('@/tools/pdf')),
  preload: () => import('@/tools/pdf'),
  keywords: ['pdf', 'merge', 'split', 'watermark', 'compress', '合并', '拆分', '水印', '压缩', '提取图片', '转图片'],
  description: 'PDF 合并/拆分/水印/压缩/转图片/提取图片，全程本地处理',
});
