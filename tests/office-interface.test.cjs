const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('office.html', 'utf8');

test('office route is a complete responsive page with canonical and viewport metadata', () => {
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/xn--80alhhq\.xn--p1ai\/office\.html"/);
  assert.match(html, /<main class="office-page">/);
  assert.match(html, /@media\(max-width:650px\)/);
});

test('office navigation is accessible and includes the management route', () => {
  assert.match(html, /class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
  assert.match(html, /<nav id="site-navigation" class="main-navigation"/);
  assert.match(html, /href="\/office\.html" aria-current="page"/);
  assert.match(html, /assets\/js\/main\.js/);
});

test('office exposes the agreed management modules and a separate office agent', () => {
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

test('office links only to existing public routes', () => {
  for (const route of ['/projects.html', '/centers/analytical/', '/publications.html', '/intelligence.html']) {
    assert.ok(html.includes(`href="${route}"`), `missing route: ${route}`);
  }
});

test('office page is discoverable exactly once in the XML sitemap', () => {
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  const route = 'https://xn--80alhhq.xn--p1ai/office.html';
  assert.equal(sitemap.split(route).length - 1, 1);
  assert.match(sitemap, /<urlset[^>]+sitemaps\.org\/schemas\/sitemap\/0\.9/);
  assert.match(sitemap, /<\/urlset>/);
});
