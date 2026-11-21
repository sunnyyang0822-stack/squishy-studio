const { build } = require('esbuild');
build({ entryPoints: ['src/shell-samples.js'], bundle: true, format: 'esm',
  target: 'es2022', outfile: 'assets/shell-samples.js', minify: true, supported: { 'template-literal': false },
}).catch(error => { console.error(error); process.exitCode = 1; });
