import { squishyStyles } from '../src/squishy-styles.mjs';

// The gallery and renderer share stable IDs and the same model assets.
export const galleryStyles = Object.freeze(Object.values(squishyStyles).filter(style => style.id !== 'paw'));
export function galleryHref(style) {
  return `/make/?style=${encodeURIComponent(style.id)}`;
}
