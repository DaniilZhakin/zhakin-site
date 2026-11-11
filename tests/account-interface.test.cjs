const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('account.html', 'utf8');

test('account concept is clearly marked as a static, non-authenticated prototype', () => {
  assert.match(html, /Концепция интерфейса/);
  assert.match(html, /статический демонстрационный макет/i);
  assert.match(html, /Авторизация, регистрация, профиль, персональные данные и сохранение действий не подключены/i);
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b/i);
});

test('account keeps ZP and BFU separate and disables financial operations', () => {
  assert.match(html, /ZP и BFU отображаются как самостоятельные системы/);
  assert.match(html, /ZHAKIN Points \(ZP\) и COIN УСЕРДИЕ \(BFU\) остаются раздельными системами/);
  assert.match(html, /Финансовые операции недоступны/);
  assert.match(html, /Операции отключены/);
});

test('account preserves human approval and scoped access boundaries', () => {
  assert.match(html, /подтверждение важных действий человеком/i);
  assert.match(html, /ограничен назначенными проектами/i);
  assert.match(html, /только после согласования уполномоченным человеком/i);
  assert.match(html, /должно блокировать доступ, а не открывать его по умолчанию/i);
});

test('account links only to existing public site sections', () => {
  for (const route of ['/wallet.html', '/intelligence.html', '/projects.html', '/publications.html', '/reception.html', '/institutional.html']) {
    assert.ok(html.includes(route), `missing route: ${route}`);
  }
});


test('account mobile navigation has an accessible toggle and explicit open-state styling', () => {
  assert.match(html, /class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
  assert.match(html, /<nav id="site-navigation" class="main-navigation"/);
  assert.match(html, /\.main-navigation\.active\{display:flex!important;visibility:visible;\}/);
  assert.match(html, /\.menu-toggle\{display:block;position:relative/);
  assert.match(html, /main\.js\?v=20261110-account-menu-fix-1/);
});


test('shared favicon references the approved full emblem artwork', () => {
  const icon = fs.readFileSync('favicon.svg', 'utf8');
  assert.match(icon, /<svg[^>]+viewBox="0 0 120 120"/);
  assert.match(icon, /aria-label="Оригинальная эмблема Жакин/);
  assert.ok(icon.includes('href="/favicon-120.png"'));
});


test('homepage exposes the search-compatible 120px PNG and SVG favicons', () => {
  const homepage = fs.readFileSync('index.html', 'utf8');
  const png = fs.readFileSync('favicon-120.png');
  assert.ok(homepage.includes('rel="icon" type="image/png" sizes="120x120" href="/favicon-120.png"'));
  assert.ok(homepage.includes('rel="icon" href="/favicon.svg" type="image/svg+xml"'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 120);
  assert.equal(png.readUInt32BE(20), 120);
});

