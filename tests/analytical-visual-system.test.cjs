const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const stylesheet = fs.readFileSync(path.join(root, 'assets/css/analytical-visual-system.css'), 'utf8');
const pages = [
  'centers/analytical/index.html',
  'centers/analytical/monitoring.html',
  'centers/analytical/asset-dashboard.html',
  'centers/asset-valuation/index.html'
];
test('analytical and valuation centers load the shared chart/table visual system', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /\/assets\/css\/analytical-visual-system\.css/);
  }
});
test('shared visual system covers all existing analytical chart and table surfaces', () => {
  for (const selector of [
    '.ac-live-chart', '.mn-chart-stage', '.mn-trend-stage', '.ad-chart-wrap',
    '.av-scenario-chart', '.ac-live-table-wrap', '.mn-table-wrap',
    '.mn-coverage-table-wrap', '.av-comparison-table-wrap',
    '.av-scenario-table-wrap', '.av-sensitivity-table-wrap'
  ]) assert.ok(stylesheet.includes(selector), 'Missing shared selector: ' + selector);
});
test('shared tables preserve responsive horizontal scrolling and accessible focus states', () => {
  assert.match(stylesheet, /overflow-x:auto/);
  assert.match(stylesheet, /-webkit-overflow-scrolling:touch/);
  assert.match(stylesheet, /:focus-visible/);
  assert.match(stylesheet, /@media\(max-width:700px\)/);
  assert.match(stylesheet, /prefers-reduced-motion:reduce/);
});
test('shared table presentation uses the ZHAKIN graphite, emerald and gold palette', () => {
  for (const token of ['#071a16', '#102820', '#d4af37', '#e5d6a5']) {
    assert.ok(stylesheet.includes(token), 'Missing design token: ' + token);
  }
});
