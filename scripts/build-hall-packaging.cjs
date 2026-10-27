// Reproducible hall packaging export.
//   node scripts/build-hall-packaging.cjs [ids…] [--preview] [--samples=N] [--tiles=N] [--views] [--out=dir]
// Integrated GPUs on Windows may hit the 2 s driver timeout (TDR): raise --tiles.
// Bundles scripts/hall-packaging/studio.js in memory, path-traces each package in
// a local Edge/Chromium page and writes transparent WebP (2× and 1×) plus a
// manifest with the tag print quad used to place the real page text.
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, extname } = require('node:path');

const root = resolve(__dirname, '..');
const spec = JSON.parse(readFileSync(join(root, 'assets-source/hall-packaging/spec.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}`));
const value = (name, fallback) => { const a = flag(name); return a && a.includes('=') ? a.split('=')[1] : fallback; };
const ids = args.filter(a => !a.startsWith('--'));
const targets = ids.length ? ids : Object.keys(spec.styles);
const preview = !!flag('preview'), samples = Number(value('samples', spec.render.samples)), tiles = Number(value('tiles', spec.render.tiles));
const runtimeDir = join(root, 'assets/hall-packaging');
const reviewDir = resolve(root, value('out', 'artifacts/issue-37/renders'));

for (const id of targets) if (!spec.styles[id]) throw new Error(`Unknown style ${id}`);

// Review views: same camera rules, with a side view and close-ups of key details.
const views = {
  side: { yaw: 32, tilt: 14 },
  'detail-film': { frame: { left: -1.0, right: .9, bottom: -.6, top: 1.776 }, width: 720, height: 900, fov: 12 },
  'detail-tag': { frame: { left: .8, right: 2.62, bottom: .55, top: 2.3 }, width: 720, height: 720, fov: 12 },
  'detail-seal': { frame: { left: -1.7, right: .3, bottom: -2.3, top: -1.5 }, width: 900, height: 360, fov: 12 },
};

(async () => {
  const bundled = await build({ entryPoints: [join(root, 'scripts/hall-packaging/studio.js')], bundle: true, format: 'esm', target: 'es2022', write: false, logLevel: 'silent' });
  const script = bundled.outputFiles[0].text;
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined), args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); else console.log('  [page]', m.text()); });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.route('http://studio.local/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="/studio.js"></script>' });
    if (path === '/studio.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    const file = join(root, decodeURIComponent(path));
    if (!file.startsWith(join(root, 'assets'))) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: extname(file) === '.glb' ? 'model/gltf-binary' : 'application/octet-stream', body: readFileSync(file) });
  });
  await page.goto('http://studio.local/');
  await page.waitForFunction(() => window.studio);
  const gpu = await page.evaluate(() => window.studio.gpu());
  console.log(`renderer: ${gpu}`);
  mkdirSync(runtimeDir, { recursive: true }); mkdirSync(reviewDir, { recursive: true });
  const manifestPath = join(runtimeDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, styles: {} };
  const report = [];
  for (const id of targets) {
    const front = await page.evaluate(([s, i, v]) => window.studio.render(s, i, v), [spec, id, { preview, samples, tiles, formats: ['webp', 'png'], scales: [1, .5] }]);
    const suffix = preview ? '-preview' : '';
    writeFileSync(join(reviewDir, `${id}-front${suffix}.png`), Buffer.from(front.files['png@1'], 'base64'));
    if (!preview) {
      writeFileSync(join(runtimeDir, `${id}@2x.webp`), Buffer.from(front.files['webp@1'], 'base64'));
      writeFileSync(join(runtimeDir, `${id}.webp`), Buffer.from(front.files['webp@0.5'], 'base64'));
      const { width, height } = front.meta, pct = ([x, y]) => [+(x / width * 100).toFixed(2), +(y / height * 100).toFixed(2)];
      manifest.styles[id] = {
        image: `/assets/hall-packaging/${id}.webp`, image2x: `/assets/hall-packaging/${id}@2x.webp`, width, height,
        tagPrint: front.meta.printQuad.map(pct), bag: front.meta.bagQuad.map(pct), toyColor: front.meta.toyColor, ink: front.meta.ink,
      };
    }
    const sizes = { webp2x: Buffer.byteLength(front.files['webp@1'], 'base64'), webp1x: Buffer.byteLength(front.files['webp@0.5'], 'base64') };
    report.push({ id, ...front.meta.stats, ...sizes });
    console.log(`${id}: ${JSON.stringify({ ...front.meta.stats, ...sizes })}`);
    if (flag('views')) for (const [name, view] of Object.entries(views)) {
      const detail = await page.evaluate(([s, i, v]) => window.studio.render(s, i, v), [spec, id, { ...view, preview, samples, tiles, formats: ['png'] }]);
      writeFileSync(join(reviewDir, `${id}-${name}${suffix}.png`), Buffer.from(detail.files['png@1'], 'base64'));
      console.log(`  ${name}: ${detail.meta.stats.seconds}s`);
    }
  }
  if (!preview) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(reviewDir, `report${preview ? '-preview' : ''}.json`), JSON.stringify({ renderer: gpu, samples: preview ? 0 : samples, report }, null, 2) + '\n');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
