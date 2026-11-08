const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const page = read('platform.html');
const css = read('assets/css/platform.css');
const js = read('assets/js/platform-directory.js');
const index = read('index.html');
const projects = read('projects.html');

test('platform directory links to existing public routes', () => {
  const routes = [...page.matchAll(/href="(\/[a-z0-9-]+\.html)"/g)].map(match => match[1]);
  assert.ok(routes.length >= 8, 'expected a meaningful set of directory routes');
  for (const route of routes) {
    const file = route.replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `missing route target: ${route}`);
  }
});

test('platform directory is discoverable from primary site navigation', () => {
  assert.match(index, /href="\/platform\.html"/);
  assert.match(projects, /href="platform\.html"/);
});

test('catalog exposes search, accessible filters, and explicit service states', () => {
  assert.match(page, /id="platform-search"/);
  assert.match(page, /aria-pressed="true"/);
  assert.match(page, /status-prototype/);
  assert.match(page, /status-development/);
  assert.match(page, /реальные платежи, переводы и операции не активированы/i);
});

test('catalog filtering updates the visible cards and live result count', () => {
  assert.match(js, /addEventListener\('input'/);
  assert.match(js, /data-filter/);
  assert.match(js, /aria-pressed/);
  assert.match(page, /aria-live/);
  assert.match(js, /card\.hidden = !show/);
});

test('mobile layout and reduced-motion preferences are defined', () => {
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
});
