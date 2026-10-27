const { build } = require('esbuild');
// Hall packaging runtime: loads baked packages and renders each one once.
build({
  entryPoints: ['src/hall-packaging/runtime.mjs'], bundle: true, format: 'esm',
  target: 'es2022', outfile: 'assets/hall-packaging.js', minify: true,
  supported: { 'template-literal': false },
}).catch(error => { console.error(error); process.exitCode = 1; });
