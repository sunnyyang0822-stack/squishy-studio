for (const image of document.querySelectorAll('.style-art img')) {
  const fail = () => { image.hidden = true; image.nextElementSibling.hidden = false; };
  image.addEventListener('error', fail, { once: true });
  if (image.complete && !image.naturalWidth) fail();
}

// Returning to choose a different shape carries only the maker's enum fields.
// No storage or account is introduced, and plain static links still work.
const source = new URL(location.href);
const preferenceKeys = ['coreMaterial', 'coreColor', 'shellMaterial', 'waxColor', 'polishColor', 'waxThickness'];
for (const entry of document.querySelectorAll('.style-entry')) {
  const target = new URL(entry.href);
  for (const key of preferenceKeys) if (source.searchParams.has(key)) target.searchParams.set(key, source.searchParams.get(key));
  entry.href = target.pathname + target.search;
}
