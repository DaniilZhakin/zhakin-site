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
