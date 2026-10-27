import { squishyStyles } from '../src/squishy-styles.mjs';

// The gallery and renderer share stable IDs and the same model assets.
export const galleryStyles = Object.freeze(Object.values(squishyStyles));
export function galleryHref(style) {
  return `/squishy/cloud/?style=${encodeURIComponent(style.id)}`;
}
