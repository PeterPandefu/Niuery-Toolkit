// UI Color Palettes Data

export interface PaletteRow {
  name: string;
  colors: string[];
}

export interface PaletteSet {
  name: string;
  rows: PaletteRow[];
}

// Ant Design Colors
export const antDesignPalette: PaletteSet = {
  name: 'Ant Design',
  rows: [
    { name: '中性', colors: ['#ffffff', '#fafafa', '#f5f5f5', '#f0f0f0', '#d9d9d9', '#bfbfbf', '#8c8c8c', '#595959', '#434343', '#262626'] },
    { name: '薄暮', colors: ['#fff1f0', '#ffccc7', '#ffa39e', '#ff7875', '#ff4d4f', '#f5222d', '#cf1322', '#a8071a', '#820014', '#5c0011'] },
    { name: '火山', colors: ['#fff2e8', '#ffd8bf', '#ffbb96', '#ff9c6e', '#ff7a45', '#fa541c', '#d4380d', '#ad2102', '#871400', '#610b00'] },
    { name: '日暮', colors: ['#fffbe6', '#fff1b8', '#ffe58f', '#ffd666', '#ffc53d', '#faad14', '#d48806', '#ad6800', '#874d00', '#613400'] },
    { name: '金盏花', colors: ['#fffbe6', '#fff1b8', '#ffe58f', '#ffd666', '#ffc53d', '#faad14', '#d48806', '#ad6800', '#874d00', '#613400'] },
    { name: '日出', colors: ['#feffe6', '#ffffb8', '#fffb8f', '#fff566', '#ffec3d', '#fadb14', '#d4b106', '#ad8b00', '#876800', '#614700'] },
    { name: '青柠', colors: ['#fcffe6', '#f4ffb8', '#eaff8f', '#d3f261', '#bae637', '#a0d911', '#7cb305', '#5b8c00', '#3f6600', '#254000'] },
    { name: '极光绿', colors: ['#f6ffed', '#d9f7be', '#b7eb8f', '#95de64', '#73d13d', '#52c41a', '#389e0d', '#237804', '#135200', '#092b00'] },
    { name: '明青', colors: ['#e6fffb', '#b5f5ec', '#87e8de', '#5cdbd3', '#36cfc9', '#13c2c2', '#08979c', '#006d75', '#00474f', '#002329'] },
    { name: '拂晓蓝', colors: ['#e6f7ff', '#bae7ff', '#91d5ff', '#69c0ff', '#40a9ff', '#1890ff', '#096dd9', '#0050b3', '#003a8c', '#002766'] },
    { name: '极客蓝', colors: ['#e6f4ff', '#bae0ff', '#91caff', '#69b1ff', '#4096ff', '#1677ff', '#0958d9', '#003eb3', '#002c8c', '#001d66'] },
    { name: '酱紫', colors: ['#f9f0ff', '#efdbff', '#d3adf7', '#b37feb', '#9254de', '#722ed1', '#531dab', '#391085', '#22075e', '#120338'] },
    { name: '洋红', colors: ['#fff0f6', '#ffd6e7', '#ffadd2', '#ff85c0', '#f759ab', '#eb2f96', '#c41d7f', '#9e1068', '#780650', '#520339'] },
  ],
};

// Flat UI Colors
export const flatUiPalette: PaletteSet = {
  name: 'Flat UI',
  rows: [
    { name: '红色', colors: ['#FF6B6B', '#EE5A24', '#C0392B', '#E74C3C', '#FF4757', '#FC5C65', '#EB3B5A', '#D63031', '#B71540', '#6F1E51'] },
    { name: '橙色', colors: ['#FFA502', '#FF6348', '#E17055', '#F39C12', '#E67E22', '#D35400', '#FF7F50', '#FF9F43', '#EE5A24', '#CD6133'] },
    { name: '黄色', colors: ['#FECA57', '#FFDD59', '#F9CA24', '#F6E58D', '#FFC312', '#C4E538', '#FDA7DF', '#ED4C67', '#F79F1F', '#A3CB38'] },
    { name: '绿色', colors: ['#2ED573', '#26DE81', '#20BF6B', '#0FB9B1', '#2BCBBA', '#45Aaf2', '#4B7BEC', '#3867D6', '#2D98DA', '#0984E3'] },
    { name: '蓝色', colors: ['#54A0FF', '#2E86DE', '#3498DB', '#2980B9', '#1B9CFC', '#18DCFF', '#7EFFf5', '#0ABDE3', '#48DBFB', '#00D2D3'] },
    { name: '紫色', colors: ['#A55EEA', '#8854D0', '#6C5CE7', '#5F27CD', '#341F97', '#833471', '#6A0572', '#AB83A1', '#B33771', '#833471'] },
    { name: '灰色', colors: ['#DCDDE1', '#C8D6E5', '#8395A7', '#576574', '#222F3E', '#535C68', '#636E72', '#2D3436', '#B2BEC3', '#DFE6E9'] },
  ],
};

// Fluent Design Colors
export const fluentPalette: PaletteSet = {
  name: 'Fluent Design',
  rows: [
    { name: '灰色', colors: ['#FAF9F8', '#F3F2F1', '#EDEBE9', '#E1DFDD', '#D2D0CE', '#C8C6C4', '#B3B0AD', '#979593', '#797775', '#605E5C'] },
    { name: '红色', colors: ['#FDE7E9', '#F5B7BC', '#E74B3C', '#D13438', '#C50F1F', '#A4262C', '#8E1D23', '#77191E', '#601419', '#490F14'] },
    { name: '橙色', colors: ['#FFF4CE', '#FEE3A3', '#F7B955', '#E88B00', '#CA5010', '#A74109', '#843207', '#612405', '#3E1603', '#1C0801'] },
    { name: '黄色', colors: ['#FFF4CE', '#FEE3A3', '#F7D046', '#F2C811', '#E8B300', '#C19C00', '#9A7D0A', '#735F08', '#4C4105', '#262003'] },
    { name: '绿色', colors: ['#DFF6DD', '#9FD89F', '#498205', '#107C10', '#0B6A0B', '#095509', '#074007', '#052B05', '#031603', '#020202'] },
    { name: '蓝色', colors: ['#DEECF9', '#83B6E8', '#0078D4', '#005A9E', '#004578', '#003966', '#002E54', '#002342', '#001830', '#000D1E'] },
    { name: '紫色', colors: ['#E8D5F5', '#C3A0E0', '#881798', '#6B127B', '#500D5E', '#350941', '#1A0424', '#000000', '#000000', '#000000'] },
  ],
};

// Open Color
export const openColorPalette: PaletteSet = {
  name: 'Open Color',
  rows: [
    { name: '灰色', colors: ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#868e96', '#495057', '#343a40', '#212529'] },
    { name: '红色', colors: ['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#fa5252', '#f03e3e', '#e03131', '#c92a2a'] },
    { name: '粉色', colors: ['#fff0f6', '#ffdeeb', '#fcc2d7', '#faa2c1', '#f783ac', '#f06595', '#e64980', '#d6336c', '#c2255c', '#a61e4d'] },
    { name: '葡萄紫', colors: ['#f8f0fc', '#f3d9fa', '#eebefa', '#e599f7', '#da77f2', '#cc5de8', '#be4bdb', '#ae3ec9', '#9c36b5', '#862e9c'] },
    { name: '紫罗兰', colors: ['#f3f0ff', '#e5dbff', '#d0bfff', '#b197fc', '#9775fa', '#845ef7', '#7950f2', '#7048e8', '#6741d9', '#5f3dc4'] },
    { name: '靛蓝', colors: ['#edf2ff', '#dbe4ff', '#bac8ff', '#91a7ff', '#748ffc', '#5c7cfa', '#4c6ef5', '#4263eb', '#3b5bdb', '#364fc7'] },
    { name: '蓝色', colors: ['#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7', '#339af0', '#228be6', '#1c7ed6', '#1971c2', '#1864ab'] },
    { name: '青色', colors: ['#e3fafc', '#c5f6fa', '#99e9f2', '#66d9e8', '#3bc9db', '#22b8cf', '#15aabf', '#1098ad', '#0c8599', '#0b7285'] },
    { name: '蓝绿', colors: ['#e6fcf5', '#c3fae8', '#96f2d7', '#63e6be', '#38d9a9', '#20c997', '#12b886', '#0ca678', '#099268', '#087f5b'] },
    { name: '绿色', colors: ['#ebfbee', '#d3f9d8', '#b2f2bb', '#8ce99a', '#69db7c', '#51cf66', '#40c057', '#37b24d', '#2f9e44', '#2b8a3e'] },
    { name: '黄绿', colors: ['#f4fce3', '#e9fac8', '#d8f5a2', '#c0eb75', '#a9e34b', '#94d82d', '#82c91e', '#74b816', '#66a80f', '#5c940d'] },
    { name: '黄色', colors: ['#fff9db', '#fff3bf', '#ffec99', '#ffe066', '#ffd43b', '#fcc419', '#fab005', '#f59f00', '#f08c00', '#e67700'] },
    { name: '橙色', colors: ['#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d', '#ff922b', '#fd7e14', '#f76707', '#e8590c', '#d9480f'] },
  ],
};

// Material Design Colors
export const materialPalette: PaletteSet = {
  name: 'Material Design',
  rows: [
    { name: '红色', colors: ['#FFEBEE', '#FFCDD2', '#EF9A9A', '#E57373', '#EF5350', '#F44336', '#E53935', '#D32F2F', '#C62828', '#B71C1C'] },
    { name: '粉色', colors: ['#FCE4EC', '#F8BBD0', '#F48FB1', '#F06292', '#EC407A', '#E91E63', '#D81B60', '#C2185B', '#AD1457', '#880E4F'] },
    { name: '紫色', colors: ['#F3E5F5', '#E1BEE7', '#CE93D8', '#BA68C8', '#AB47BC', '#9C27B0', '#8E24AA', '#7B1FA2', '#6A1B9A', '#4A148C'] },
    { name: '深紫', colors: ['#EDE7F6', '#D1C4E9', '#B39DDB', '#9575CD', '#7E57C2', '#673AB7', '#5E35B1', '#512DA8', '#4527A0', '#311B92'] },
    { name: '靛蓝', colors: ['#E8EAF6', '#C5CAE9', '#9FA8DA', '#7986CB', '#5C6BC0', '#3F51B5', '#3949AB', '#303F9F', '#283593', '#1A237E'] },
    { name: '蓝色', colors: ['#E3F2FD', '#BBDEFB', '#90CAF9', '#64B5F6', '#42A5F5', '#2196F3', '#1E88E5', '#1976D2', '#1565C0', '#0D47A1'] },
    { name: '浅蓝', colors: ['#E1F5FE', '#B3E5FC', '#81D4FA', '#4FC3F7', '#29B6F6', '#03A9F4', '#039BE5', '#0288D1', '#0277BD', '#01579B'] },
    { name: '青色', colors: ['#E0F7FA', '#B2EBF2', '#80DEEA', '#4DD0E1', '#26C6DA', '#00BCD4', '#00ACC1', '#0097A7', '#00838F', '#006064'] },
    { name: '蓝绿', colors: ['#E0F2F1', '#B2DFDB', '#80CBC4', '#4DB6AC', '#26A69A', '#009688', '#00897B', '#00796B', '#00695C', '#004D40'] },
    { name: '绿色', colors: ['#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A', '#4CAF50', '#43A047', '#388E3C', '#2E7D32', '#1B5E20'] },
    { name: '黄绿', colors: ['#F1F8E9', '#DCEDC8', '#C5E1A5', '#AED581', '#9CCC65', '#8BC34A', '#7CB342', '#689F38', '#558B2F', '#33691E'] },
    { name: '黄色', colors: ['#FFFDE7', '#FFF9C4', '#FFF59D', '#FFF176', '#FFEE58', '#FFEB3B', '#FDD835', '#FBC02D', '#F9A825', '#F57F17'] },
    { name: '橙色', colors: ['#FFF3E0', '#FFE0B2', '#FFCC80', '#FFB74D', '#FFA726', '#FF9800', '#FB8C00', '#F57C00', '#EF6C00', '#E65100'] },
  ],
};

export const allPalettes = [flatUiPalette, fluentPalette, openColorPalette, antDesignPalette, materialPalette];

// Traditional Chinese Colors (by 24 solar terms)
export interface TraditionalColor {
  name: string;
  hex: string;
}

export interface SolarTermColors {
  term: string;
  colors: TraditionalColor[];
}

export const chineseTraditionalColors: SolarTermColors[] = [
  {
    term: '立春',
    colors: [
      { name: '黄白游', hex: '#FFF799' }, { name: '松花', hex: '#FFEE6F' }, { name: '缃叶', hex: '#ECD452' }, { name: '苍黄', hex: '#B6A014' },
      { name: '天缥', hex: '#D5EBE1' }, { name: '沧浪', hex: '#B1D5C8' }, { name: '苍筤', hex: '#99BCAC' }, { name: '缥碧', hex: '#80A492' },
      { name: '流黄', hex: '#6B7042' }, { name: '栗壳', hex: '#775039' }, { name: '龙战', hex: '#5F4321' }, { name: '青骊', hex: '#422517' },
      { name: '海天霞', hex: '#F3A694' }, { name: '缙云', hex: '#EE7959' }, { name: '纁黄', hex: '#BA5140' }, { name: '珊瑚赫', hex: '#C12C1F' },
    ],
  },
  {
    term: '雨水',
    colors: [
      { name: '盈盈', hex: '#F9D3E3' }, { name: '水红', hex: '#ECB0C1' }, { name: '苏梅', hex: '#DD7694' }, { name: '紫荃屏风', hex: '#A76283' },
      { name: '葭灰', hex: '#BE81AA' }, { name: '黄埃', hex: '#B49273' }, { name: '老僧衣', hex: '#A46244' }, { name: '玄天', hex: '#6B5458' },
      { name: '黄河琉璃', hex: '#E5A84B' }, { name: '库金', hex: '#E18A3B' }, { name: '缊', hex: '#984F31' }, { name: '紫瓯', hex: '#7C461E' },
    ],
  },
  {
    term: '惊蛰',
    colors: [
      { name: '桃夭', hex: '#F47983' }, { name: '粉红', hex: '#F0A1A8' }, { name: '桃红', hex: '#F47983' }, { name: '银红', hex: '#F05654' },
      { name: '大红', hex: '#FF2121' }, { name: '火焰', hex: '#F47983' }, { name: '朱红', hex: '#FF4C00' }, { name: '丹', hex: '#F35336' },
      { name: '彤', hex: '#F35336' }, { name: '茜', hex: '#CB3A56' }, { name: '赪', hex: '#C3272B' }, { name: '赤', hex: '#C3272B' },
    ],
  },
  {
    term: '春分',
    colors: [
      { name: '青白', hex: '#C0E2E4' }, { name: '卵色', hex: '#C0D1D4' }, { name: '青青', hex: '#68B0AB' }, { name: '碧', hex: '#68B0AB' },
      { name: '缥', hex: '#7FECAD' }, { name: '绿', hex: '#44C367' }, { name: '翠', hex: '#00B091' }, { name: '青', hex: '#00E09E' },
      { name: '葱青', hex: '#0EB83A' }, { name: '葱绿', hex: '#9ED900' }, { name: '石绿', hex: '#16A951' }, { name: '松绿', hex: '#008462' },
    ],
  },
  {
    term: '清明',
    colors: [
      { name: '紫磨金', hex: '#C9924E' }, { name: '檀', hex: '#B36D61' }, { name: '窃脂', hex: '#C9924E' }, { name: '浅红', hex: '#F0A1A8' },
      { name: '赭', hex: '#9C5333' }, { name: '棕', hex: '#B25F03' }, { name: '朱砂', hex: '#FF461F' }, { name: '殷', hex: '#782F2B' },
      { name: '紫矿', hex: '#855C75' }, { name: '欲曙', hex: '#EC7674' }, { name: '海天霞', hex: '#F3A694' }, { name: '缙云', hex: '#EE7959' },
    ],
  },
  {
    term: '谷雨',
    colors: [
      { name: '暮山紫', hex: '#824C78' }, { name: '丁香', hex: '#CCA4E3' }, { name: '雪青', hex: '#B0A4E3' }, { name: '藕荷', hex: '#E4C6D0' },
      { name: '青莲', hex: '#994C76' }, { name: '雪灰', hex: '#9B9EA2' }, { name: '豆绿', hex: '#9ED048' }, { name: '艾绿', hex: '#A4E3B6' },
      { name: '墨灰', hex: '#758A99' }, { name: '墨色', hex: '#50616D' }, { name: '鸦青', hex: '#424C50' }, { name: '玄', hex: '#622A1D' },
    ],
  },
];

// Japanese Traditional Colors
export const japaneseTraditionalColors: TraditionalColor[] = [
  { name: '桜色', hex: '#FEDFE1' }, { name: '桃色', hex: '#F47983' }, { name: '紅梅色', hex: '#F26C68' }, { name: '蘇芳', hex: '#9B3A44' },
  { name: '退紅', hex: '#F8C3CD' }, { name: '一斥染', hex: '#F4A7B9' }, { name: '桑染', hex: '#64363C' }, { name: '唐紅', hex: '#913839' },
  { name: '根岸色', hex: '#C18A5C' }, { name: '金茶', hex: '#C7802D' }, { name: '伽羅色', hex: '#785E40' }, { name: '琥珀色', hex: '#CA6924' },
  { name: '黄蘗', hex: '#F3C13A' }, { name: '刈安', hex: '#E9CD4C' }, { name: '梔子色', hex: '#F6C555' }, { name: '鬱金色', hex: '#FFC408' },
  { name: '白緑', hex: '#E8F2E4' }, { name: '若竹色', hex: '#68BE8D' }, { name: '千歳緑', hex: '#316745' }, { name: '緑', hex: '#47885E' },
  { name: '白群', hex: '#7DB9DE' }, { name: '水色', hex: '#A0D7E2' }, { name: '藍', hex: '#165E83' }, { name: '瑠璃色', hex: '#1E50A2' },
  { name: '藤色', hex: '#BAA8D2' }, { name: '桔梗色', hex: '#6C529C' }, { name: '紫', hex: '#592E7E' }, { name: '江戸紫', hex: '#77428D' },
];

// Gradient Presets
export interface GradientPreset {
  colors: [string, string];
  angle: number;
}

export const gradientPresets: GradientPreset[] = [
  { colors: ['#fce38a', '#f38181'], angle: 135 },
  { colors: ['#f857a6', '#ff5858'], angle: 135 },
  { colors: ['#00c9ff', '#92fe9d'], angle: 135 },
  { colors: ['#834d9b', '#d04ed6'], angle: 135 },
  { colors: ['#7b4397', '#dc2430'], angle: 135 },
  { colors: ['#11998e', '#38ef7d'], angle: 135 },
  { colors: ['#fc5c7d', '#6a82fb'], angle: 135 },
  { colors: ['#4b6cb7', '#182848'], angle: 135 },
  { colors: ['#2c3e50', '#3498db'], angle: 135 },
  { colors: ['#614385', '#516395'], angle: 135 },
  { colors: ['#eecda3', '#ef629f'], angle: 135 },
  { colors: ['#48c6ef', '#6f86d6'], angle: 135 },
  { colors: ['#0ba360', '#3cba92'], angle: 135 },
  { colors: ['#f7971e', '#ffd200'], angle: 135 },
  { colors: ['#56ccf2', '#2f80ed'], angle: 135 },
  { colors: ['#a8edea', '#fed6e3'], angle: 135 },
  { colors: ['#d299c2', '#fef9d7'], angle: 135 },
  { colors: ['#667eea', '#764ba2'], angle: 135 },
  { colors: ['#f093fb', '#f5576c'], angle: 135 },
  { colors: ['#4facfe', '#00f2fe'], angle: 135 },
];

// Color filter categories for traditional/gradient tabs
export const colorFilterDots = [
  '#E91E63', '#FF9800', '#FFEB3B', '#4CAF50', '#2196F3', '#009688', '#9C27B0', '#E0E0E0', '#9E9E9E', '#424242',
];
