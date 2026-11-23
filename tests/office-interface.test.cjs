const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('office.html', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

test('office route is a complete responsive page with canonical and viewport metadata', () => {
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/xn--80alhhq\.xn--p1ai\/office\.html"/);
  assert.match(html, /<main class="office-page">/);
  assert.match(html, /@media\(max-width:650px\)/);
});

test('office navigation is accessible and includes both expert centres and office route', () => {
  assert.match(html, /class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
  assert.match(html, /<nav id="site-navigation" class="main-navigation"/);
  for (const route of ['/centers/', '/centers/asset-valuation/', '/centers/analytical/', '/office.html']) {
    assert.ok(html.includes(`href="${route}"`), `missing navigation route: ${route}`);
  }
  assert.match(html, /assets\/js\/main\.js/);
});

test('office exposes agreed management modules and a separate office agent', () => {
  for (const phrase of ['Стратегические направления', 'Портфель проектов', 'Поручения и исполнение', 'Решения и протоколы', 'Результаты и аналитика', 'Документы и знания', 'Управленческий помощник']) {
    assert.ok(html.includes(phrase), `missing office module: ${phrase}`);
  }
  assert.match(html, /OFFICE AGENT/);
});

test('office prototype does not pretend to provide live task data, auth, or external actions', () => {
  assert.match(html, /демонстрационная версия интерфейса/);
  assert.match(html, /авторизация, роли, документы, уведомления, аудит и сохранение изменений пока не подключены/i);
  assert.match(html, /не отправляет документы без подтверждения человека/);
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b|<button\b(?![^>]*class="menu-toggle")/i);
});

test('office links to public existing modules and documents', () => {
  for (const route of ['/projects.html', '/centers/analytical/', '/publications.html', '/intelligence.html']) {
    assert.ok(html.includes(`href="${route}"`), `missing route: ${route}`);
  }
});

test('sitemap contains office and asset valuation routes exactly once', () => {
  for (const route of ['https://xn--80alhhq.xn--p1ai/office.html', 'https://xn--80alhhq.xn--p1ai/centers/asset-valuation/']) {
    assert.equal(sitemap.split(route).length - 1, 1, `route count mismatch: ${route}`);
  }
  assert.match(sitemap, /<urlset[^>]+sitemaps\.org\/schemas\/sitemap\/0\.9/);
  assert.match(sitemap, /<\/urlset>/);
});
