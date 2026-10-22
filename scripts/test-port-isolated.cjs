// Local worktrees run concurrently on this computer. Execute unchanged test
// assertions against a separate port range so another run cannot take over or
// terminate their servers. CI continues to run the ordinary `npm test` command.
const { readdirSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const offset = Number(process.env.TEST_PORT_OFFSET || 1000);
if (!Number.isInteger(offset) || offset < 100 || offset > 50000) throw new Error('TEST_PORT_OFFSET must be an integer from 100 to 50000');
const copies = [];
try {
  for (const name of readdirSync(join(root,'tests')).filter(name=>name.endsWith('.test.cjs')).sort()) {
    const source = readFileSync(join(root,'tests',name),'utf8');
    const isolated = source.replace(/http:\/\/127\.0\.0\.1:(\d+)/g, (_,port)=>`http://127.0.0.1:${Number(port)+offset}`)
      .replace(/(\bPORT\s*:\s*['"])(\d+)(['"])/g,(_,prefix,port,suffix)=>`${prefix}${Number(port)+offset}${suffix}`);
    const file = join(root,'tests',`.__isolated-${process.pid}-${name}.cjs`);
    writeFileSync(file,isolated); copies.push(file);
  }
  console.log(`Running all ${copies.length} original test files with port offset +${offset}; assertions unchanged; concurrency=1.`);
  const result = spawnSync(process.execPath,['--test','--test-concurrency=1',...copies],{cwd:root,stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  for(const file of copies) unlinkSync(file);
}
