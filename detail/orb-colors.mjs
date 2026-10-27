// Shared by the native color controls and the model renderer.
export const orbColors = Object.freeze([
  { id: 'rose', name: '奶油粉', hex: '#EFB3C9' },
  { id: 'coral', name: '珊瑚红', hex: '#E9A39C' },
  { id: 'peach', name: '杏子橙', hex: '#EFBE99' },
  { id: 'lemon', name: '柠檬黄', hex: '#EFDC9B' },
  { id: 'pistachio', name: '开心果', hex: '#CFD99E' },
  { id: 'mint', name: '薄荷绿', hex: '#ADCFB4' },
  { id: 'aqua', name: '浅青', hex: '#A7D4CF' },
  { id: 'sky', name: '雾蓝', hex: '#AAC7E3' },
  { id: 'lavender', name: '薰衣紫', hex: '#C6B4DC' },
  { id: 'cream', name: '奶油白', hex: '#EDE1CF' },
].map(color => Object.freeze(color)));
export const colorNames = Object.freeze(Object.fromEntries(orbColors.map(({ id, name }) => [id, name])));
