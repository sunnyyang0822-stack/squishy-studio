const { build } = require('esbuild');
build({
  entryPoints: ['src/orb-preview.js'], bundle: true, format: 'esm',
  target: 'es2022', outfile: 'assets/orb-preview.js', minify: true,
  // Escape bundled GLSL strings instead of emitting their whitespace as JS lines.
  supported: { 'template-literal': false },
}).catch(error => { console.error(error); process.exitCode = 1; });
