import { lazy } from 'react';
import { ToolDefinition, ToolCategory } from '@/types/tool';
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
  FileText,
  Fingerprint,
  Globe,
  Hash,
  Image,
  KeyRound,
  Link2,
  Minimize2,
  Paintbrush,
  Palette,
  QrCode,
  Regex,
  Shield,
  ShieldCheck,
  Shuffle,
  Square,
  Type,
  Wind,
} from 'lucide-react';

// 工具注册表
const toolRegistry = new Map<string, ToolDefinition>();

// 注册工具函数
export function registerTool(tool: ToolDefinition) {
  toolRegistry.set(tool.id, tool);
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

// 获取所有分类（有工具的）
export function getAvailableCategories(): ToolCategory[] {
  const categories = new Set(getAllTools().map((tool) => tool.category));
  return Array.from(categories);
}

// ==================== 注册所有工具 ====================

// === 转换器 ===
registerTool({
  id: 'json-yaml',
  name: 'JSON ↔ YAML',
  icon: ArrowLeftRight,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/json-yaml')),
  keywords: ['json', 'yaml', 'yml', '转换', 'convert'],
  description: 'JSON 与 YAML 双向实时转换',
});

registerTool({
  id: 'xml-json',
  name: 'XML ↔ JSON',
  icon: FileCode2,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/xml-json')),
  keywords: ['xml', 'json', '转换', 'convert'],
  description: 'XML 与 JSON 双向转换',
});

registerTool({
  id: 'timestamp',
  name: '时间戳转换',
  icon: Clock,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/timestamp')),
  keywords: ['timestamp', 'unix', '时间', '日期', 'date', 'time'],
  description: 'Unix 时间戳与日期互转',
});

registerTool({
  id: 'number-base',
  name: '进制转换',
  icon: Binary,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/number-base')),
  keywords: ['binary', 'hex', 'octal', 'decimal', '进制', '二进制', '十六进制'],
  description: '二/八/十/十六进制互转',
});

registerTool({
  id: 'color-picker',
  name: '颜色助手',
  icon: Palette,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/color-assistant')),
  keywords: ['color', 'hex', 'rgb', 'hsl', '颜色', '取色', '色卡', '渐变', '传统色', 'palette', 'gradient'],
  description: '颜色选择、UI色卡、传统色、渐变色、图片取色',
});

registerTool({
  id: 'data-size',
  name: '数据大小转换',
  icon: FileDigit,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/data-size')),
  keywords: ['byte', 'kb', 'mb', 'gb', '数据', '大小', 'size'],
  description: 'B/KB/MB/GB/TB 数据大小互转',
});

registerTool({
  id: 'angle',
  name: '角度转换',
  icon: Compass,
  category: 'converter',
  component: lazy(() => import('@/tools/converter/angle')),
  keywords: ['angle', 'degree', 'radian', 'grad', '角度', '弧度'],
  description: '度/弧度/梯度互转',
});

// === 编码器/解码器 ===
registerTool({
  id: 'base64',
  name: 'Base64',
  icon: Code2,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/base64')),
  keywords: ['base64', 'encode', 'decode', '编码', '解码'],
  description: '文本/文件 Base64 编解码',
});

registerTool({
  id: 'url-encode',
  name: 'URL 编解码',
  icon: Link2,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/url-encode')),
  keywords: ['url', 'uri', 'encode', 'decode', '编码', '解码', 'percent'],
  description: 'URL 组件编解码',
});

registerTool({
  id: 'html-entity',
  name: 'HTML 实体',
  icon: FileText,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/html-entity')),
  keywords: ['html', 'entity', '实体', '转义', 'escape'],
  description: 'HTML 实体编解码',
});

registerTool({
  id: 'unicode',
  name: 'Unicode 转义',
  icon: Type,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/unicode')),
  keywords: ['unicode', 'utf', '转义', 'escape', '\\u'],
  description: 'Unicode 转义/反转义',
});

registerTool({
  id: 'jwt-decoder',
  name: 'JWT 解析器',
  icon: Shield,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/jwt-decoder')),
  keywords: ['jwt', 'token', 'json web token', '解析'],
  description: 'JWT 令牌解析与验证',
});

registerTool({
  id: 'qrcode',
  name: '二维码',
  icon: QrCode,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/qrcode')),
  keywords: ['qr', 'qrcode', '二维码', '扫码'],
  description: '文本与二维码互转',
});

registerTool({
  id: 'gzip',
  name: 'GZip 压缩',
  icon: Wind,
  category: 'encoder',
  component: lazy(() => import('@/tools/encoder/gzip')),
  keywords: ['gzip', 'deflate', 'compress', '压缩', '解压', 'decompress'],
  description: 'GZip/Deflate 压缩解压',
});

// === 格式化器 ===
registerTool({
  id: 'json-formatter',
  name: 'JSON 格式化',
  icon: FileJson,
  category: 'formatter',
  component: lazy(() => import('@/tools/formatter/json-formatter')),
  keywords: ['json', 'format', 'beautify', '格式化', '美化'],
  description: 'JSON 美化/压缩/校验',
});

registerTool({
  id: 'xml-formatter',
  name: 'XML 格式化',
  icon: FileCode2,
  category: 'formatter',
  component: lazy(() => import('@/tools/formatter/xml-formatter')),
  keywords: ['xml', 'format', 'beautify', '格式化', '美化'],
  description: 'XML 美化/压缩',
});

registerTool({
  id: 'sql-formatter',
  name: 'SQL 格式化',
  icon: Braces,
  category: 'formatter',
  component: lazy(() => import('@/tools/formatter/sql-formatter')),
  keywords: ['sql', 'mysql', 'postgres', 'format', '格式化', '查询'],
  description: 'SQL 查询美化',
});

registerTool({
  id: 'markdown-editor',
  name: 'Markdown 编辑器',
  icon: FileText,
  category: 'formatter',
  component: lazy(() => import('@/tools/formatter/markdown-editor')),
  keywords: ['markdown', 'md', 'editor', 'preview', '编辑', '预览', '渲染', '写作'],
  description: 'Markdown 编辑器：实时预览、工具栏、导出',
});

// === 生成器 ===
registerTool({
  id: 'uuid-generator',
  name: 'UUID 生成器',
  icon: Fingerprint,
  category: 'generator',
  component: lazy(() => import('@/tools/generator/uuid-generator')),
  keywords: ['uuid', 'guid', 'ulid', 'nanoid', '生成'],
  description: 'UUID v1/v4/v5/ULID/NanoID 生成',
});

registerTool({
  id: 'hash-generator',
  name: 'Hash 生成器',
  icon: Hash,
  category: 'generator',
  component: lazy(() => import('@/tools/generator/hash-generator')),
  keywords: ['hash', 'md5', 'sha', 'sha256', 'sha512', '哈希', '校验'],
  description: 'MD5/SHA1/SHA256/SHA512 哈希计算',
});

registerTool({
  id: 'password-generator',
  name: '密码生成器',
  icon: KeyRound,
  category: 'generator',
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
  category: 'generator',
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
  name: '粘贴板历史',
  icon: ClipboardList,
  category: 'text',
  component: lazy(() => import('@/tools/text/clipboard-history')),
  keywords: ['clipboard', 'paste', 'copy', 'history', '粘贴板', '剪贴板', '复制', '历史', '记录'],
  description: '剪贴板历史记录与重新复制',
});

// === 图形工具 ===
registerTool({
  id: 'image-compressor',
  name: '图片压缩',
  icon: Minimize2,
  category: 'graphic',
  component: lazy(() => import('@/tools/graphic/image-compressor')),
  keywords: ['image', 'compress', '图片', '压缩', 'png', 'jpg'],
  description: 'PNG/JPEG 图片压缩',
});

registerTool({
  id: 'image-converter',
  name: '图片转换',
  icon: Image,
  category: 'graphic',
  component: lazy(() => import('@/tools/graphic/image-converter')),
  keywords: ['image', 'convert', '图片', '转换', 'webp', 'avif'],
  description: '图片格式互转',
});

registerTool({
  id: 'svg-optimizer',
  name: 'SVG 优化',
  icon: Paintbrush,
  category: 'graphic',
  component: lazy(() => import('@/tools/graphic/svg-optimizer')),
  keywords: ['svg', 'optimize', '优化', '矢量'],
  description: 'SVG 精简优化',
});

registerTool({
  id: 'icon-generator',
  name: '图标生成器',
  icon: Square,
  category: 'graphic',
  component: lazy(() => import('@/tools/graphic/icon-generator')),
  keywords: ['icon', 'favicon', '图标', '生成', 'app', 'ios', 'android'],
  description: '从图片生成应用图标',
});

registerTool({
  id: 'screenshot-editor',
  name: '截图',
  icon: Camera,
  category: 'graphic',
  component: lazy(() => import('@/tools/graphic/screenshot-editor')),
  keywords: ['screenshot', 'capture', 'annotate', '截图', '截屏', '标注', '编辑'],
  description: '屏幕截图捕获与标注编辑',
});

// === 网络工具 ===
registerTool({
  id: 'socket-tool',
  name: 'Socket 调试',
  icon: Globe,
  category: 'network',
  component: lazy(() => import('@/tools/network/socket-tool')),
  keywords: ['socket', 'websocket', 'ws', '网络', '连接', 'server', 'client', '调试'],
  description: 'WebSocket 客户端/服务端调试',
});

// === 网络工具 ===
registerTool({
  id: 'api-tester',
  name: '接口测试',
  icon: Globe,
  category: 'network',
  component: lazy(() => import('@/tools/network/api-tester')),
  keywords: ['api', 'http', 'rest', 'request', 'response', '接口', '请求', '调试', 'postman', 'apifox'],
  description: 'HTTP API 接口调试测试',
});
