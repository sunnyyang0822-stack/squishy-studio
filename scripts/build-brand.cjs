const { openSync } = require('fontkit');
const { build } = require('esbuild');
const { writeFileSync } = require('node:fs');

const font = openSync('assets/fredoka-latin-700-normal.woff2');
const glyphs = {};
for (const char of new Set('SquishyStudio?')) {
  const glyph = font.glyphForCodePoint(char.codePointAt(0));
  const commands = [];
  let first;
  for (const part of glyph.path.commands) {
    const [a, b, c, d, e, f] = part.args;
    if (part.command === 'moveTo') { commands.push('m', a, b); first = [a, b]; }
    if (part.command === 'lineTo') commands.push('l', a, b);
    if (part.command === 'quadraticCurveTo') commands.push('q', c, d, a, b);
    if (part.command === 'bezierCurveTo') commands.push('b', e, f, a, b, c, d);
    if (part.command === 'closePath' && first) commands.push('l', ...first);
  }
  glyphs[char] = { ha: glyph.advanceWidth, o: commands.join(' ') };
}
writeFileSync('assets/fredoka-typeface.json', JSON.stringify({
  glyphs, familyName: 'Fredoka', resolution: font.unitsPerEm,
  boundingBox: { yMin: font.descent, yMax: font.ascent },
  ascender: font.ascent, descender: font.descent, underlineThickness: 25,
}));

build({
  entryPoints: ['src/brand3d.js'], bundle: true, format: 'iife',
  target: 'es2022', outfile: 'assets/brand3d.js', minify: true,
}).catch(error => { console.error(error); process.exitCode = 1; });
