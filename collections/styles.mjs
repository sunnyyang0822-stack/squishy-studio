// Frontend gallery only. previewId is not a renderer styleId. Seven shapes
// remain artwork concepts until the separate model delivery is integrated.
export const galleryStyles = Object.freeze([
  { id: 'orb', name: '奶油圆球', placeholder: false },
  { id: 'cloud', name: '云朵', placeholder: true },
  { id: 'paw', name: '猫爪', placeholder: true },
  { id: 'cylinder', name: '圆柱形', placeholder: true },
  { id: 'donut', name: '甜甜圈', placeholder: true },
  { id: 'pyramid', name: '三角锥', placeholder: true },
  { id: 'flower', name: '花朵', placeholder: true },
  { id: 'star', name: '五角星星', placeholder: true },
].map(Object.freeze));
export function previewStyle(id) { return galleryStyles.find(style => style.id === id && style.placeholder); }
export function galleryHref(style) { return `/squishy/cloud/?style=orb${style.placeholder ? `&preview=${style.id}` : ''}`; }
