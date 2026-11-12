const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "wallet.html"), "utf8");

test("Wallet operation dialog fits short mobile viewports and can scroll", () => {
  const dialogRule = html.match(/\.wallet-dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, "dialog style must exist");
  assert.match(dialogRule[1], /max-height:\s*calc\(100vh\s*-\s*32px\)/);
  assert.match(dialogRule[1], /overflow-y:\s*auto/);
  assert.match(html, /max-height:\s*calc\(100dvh\s*-\s*28px\)/);
});

test("Wallet dialog controls keep a usable touch target", () => {
  assert.match(html, /\.wallet-dialog-actions \.wallet-demo-button\s*\{[^}]*min-height:\s*48px/);
});

test("Top-up, gifts and transfers remain disabled with operation-specific explanations", () => {
  assert.match(html, /"Пополнение":\s*"Пополнение счёта пока не подключено/);
  assert.match(html, /"Подарки":\s*"Передача баллов в подарок пока не подключена/);
  assert.match(html, /"Переводы":\s*"Перевод баллов между участниками пока не подключён/);
  assert.match(html, /Никаких операций не выполнено/);
  assert.match(html, /Получатель и баланс не изменяются/);
});
