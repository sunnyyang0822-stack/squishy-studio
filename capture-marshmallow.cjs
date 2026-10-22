const { writeFileSync, mkdirSync } = require('node:fs');
mkdirSync('artifacts/issue-26', { recursive: true });
require('./tests/helpers/marshmallow-metrics.cjs')().then(report => {
  writeFileSync('artifacts/issue-26/geometry.json', JSON.stringify(report, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
require('./tests/helpers/marshmallow-browser.cjs')({ capture: true }).then(report => {
  writeFileSync('artifacts/issue-26/browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
