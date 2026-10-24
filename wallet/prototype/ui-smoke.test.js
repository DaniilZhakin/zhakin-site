import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const walletUrl = new URL("../../wallet.html", import.meta.url);
const homeUrl = new URL("../../index.html", import.meta.url);

test("wallet page is linked from the main site navigation", async () => {
  const home = await readFile(homeUrl, "utf8");
  assert.match(home, /href="\/wallet\.html">ZHAKIN Wallet<\/a>/);
});

test("wallet page marks itself as the current navigation destination", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /href="\/wallet\.html" aria-current="page">ZHAKIN Wallet<\/a>/);
});

test("wallet prototype clearly discloses that no account or balance is connected", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /Визуальный прототип/);
  assert.match(page, /реальный баланс и операции пока не подключены/);
  assert.match(page, /Данные появятся после защищённой авторизации/);
  assert.match(page, /class="wallet-balance" aria-label="Баланс пока недоступен">—/);
});

test("wallet prototype explains points and keeps BFU separate", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /Планируемый стартовый бонус участника/);
  assert.match(page, /10 000 <span style="font-size:\.46em;letter-spacing:\.02em">ZP<\/span>/);
  assert.match(page, /Сейчас бонус не начисляется/);
  assert.match(page, /внутренние баллы учёта подтверждённой активности/);
  assert.match(page, /COIN УСЕРДИЕ \(BFU\) является отдельным проектом фонда/);
});

test("premium visual system and responsive accessible layout are present", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /--zw-gold-light/);
  assert.match(page, /wallet-topline/);
  assert.match(page, /wallet-intro-aside/);
  assert.match(page, /wallet-card/);
  assert.match(page, /@media\s*\(max-width:\s*(600|850)px\)/);
  assert.match(page, /aria-label="Основная навигация"/);
  assert.match(page, /aria-labelledby="history-title"/);
  assert.match(page, /aria-label="Баланс пока недоступен"/);
});

test("wallet page supports keyboard navigation and high-contrast preferences", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /class="wallet-skip-link" href="#wallet-main"/);
  assert.match(page, /id="wallet-main" class="wallet-page"/);
  assert.match(page, /\.wallet-page a:focus-visible/);
  assert.match(page, /@media\(forced-colors:active\)/);
  assert.match(page, /prefers-reduced-motion:reduce/);
});

test("interactive wallet demo is explicitly synthetic and separate from the real balance", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /id="wallet-demo"[^>]*data-demo-only="true"/);
  assert.match(page, /Демо-режим · только тестовые данные/);
  assert.match(page, /Условный демо-баланс/);
  assert.match(page, /class="wallet-balance" aria-label="Баланс пока недоступен">—/);
  assert.match(page, /Синтетическая запись/);
  assert.match(page, /data-demo-task="intro"/);
  assert.match(page, /data-demo-task="rules"/);
  assert.match(page, /data-demo-task="history"/);
  assert.match(page, /wallet-demo-reset/);
  assert.match(page, /COIN УСЕРДИЕ \(BFU\) является отдельным проектом фонда/);
});

test("demo state is in-memory only and actions do not call a real wallet API", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /let demoBalance = initialBalance/);
  assert.match(page, /completed\.clear\(\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.match(page, /Никаких операций не выполнено/);
  assert.match(page, /aria-live="polite"/);
});

test("wallet transfer controls explain the limitation rather than executing operations", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /data-wallet-info="Пополнение"/);
  assert.match(page, /data-wallet-info="Подарки"/);
  assert.match(page, /data-wallet-info="Переводы"/);
  assert.match(page, /Функция пока не подключена/);
});


test("wallet action controls have interactive pointer and visible keyboard focus", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /\.wallet-action\{[^}]*cursor:pointer/);
  assert.match(page, /\.wallet-action:focus-visible\{outline:2px solid/);
  assert.doesNotMatch(page, /\\n    \.wallet-skip-link/);
});


test("demo task controls stay usable on narrow mobile screens", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /@media\(max-width:700px\)/);
  assert.match(page, /\.wallet-demo-task\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:start\}/);
  assert.match(page, /\.wallet-demo-task \.wallet-demo-button\{grid-column:2;justify-self:end;min-width:112px\}/);
  assert.match(page, /\.wallet-demo-button:focus-visible\{outline:2px solid/);
});

test("wallet visual polish provides rounded app surfaces and iPhone-sized controls", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /Visual polish v2: more app-like hierarchy/);
  assert.match(page, /\.wallet-card\{[^}]*border-radius:16px/);
  assert.match(page, /\.wallet-demo\{[^}]*border-radius:12px/);
  assert.match(page, /\.wallet-action\{[^}]*min-height:44px/);
  assert.match(page, /@media\(max-width:600px\)/);
  assert.match(page, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
