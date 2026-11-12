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

test("Wallet layout contains narrow-screen content and scrolls market tables internally", () => {
  assert.match(html, /\.wallet-page,\s*\.wallet-page \.market-board\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s);
  assert.match(html, /\.wallet-page h1,[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(html, /class="market-table-scroll" role="region" aria-label="Котировки криптоактивов[^"]*" tabindex="0"/);
  assert.match(html, /class="market-table-scroll" role="region" aria-label="Официальные валютные курсы[^"]*" tabindex="0"/);
  assert.match(html, /\.market-table-scroll:focus-visible/);
  assert.match(html, /\.wallet-collection-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(html, /@media\(max-width:850px\)\{\.wallet-collection-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(html, /@media\(max-width:600px\)\{\.wallet-collection-grid\{grid-template-columns:1fr\}\}/);
  assert.match(html, /\.market-table-scroll table\s*\{\s*min-width:\s*520px/);
  assert.match(html, /<th scope="col">Актив<\/th>/);
  assert.match(html, /<th scope="col">Валюта<\/th>/);
  assert.match(html, /\.wallet-page \.market-board > div\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(html, /@media \(max-width:\s*600px\)\s*\{[\s\S]*?\.wallet-page\s*\{[^}]*width:\s*100%/);
});
