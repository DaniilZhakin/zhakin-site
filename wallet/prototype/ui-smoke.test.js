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

test("wallet planned points volume and welcome bonus are disclosed as future-only", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.ok(page.includes("Общий плановый объём бонусов"));
  assert.ok(page.includes("3 000 000 000 000"));
  assert.ok(page.includes("Планируемый стартовый бонус участника"));
  assert.ok(page.includes("10 000"));
  assert.ok(page.includes("Сейчас бонус не начисляется"));
  assert.ok(page.includes("COIN УСЕРДИЕ (BFU) является отдельным проектом фонда"));
});

test("wallet visual polish preserves responsive accessible controls", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.ok(page.includes("Visual polish v2: more app-like hierarchy"));
  assert.ok(page.includes("border-radius:13px"));
  assert.ok(page.includes("border-radius:12px"));
  assert.ok(page.includes("min-height:44px"));
  assert.ok(page.includes("@media(max-width:600px)"));
  assert.ok(page.includes("prefers-reduced-motion:reduce"));
});

test("digital asset overview keeps ZP and BFU in separate, read-only cards", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /<section class="wallet-assets" aria-labelledby="wallet-assets-title">/);
  assert.match(page, /id="wallet-zp-title">ZHAKIN Points/);
  assert.match(page, /id="wallet-bfu-title">COIN УСЕРДИЕ/);
  assert.match(page, /aria-label="Баланс ZP недоступен">— ZP/);
  assert.match(page, /aria-label="Баланс BFU недоступен">— BFU/);
  assert.match(page, /ZP и BFU не объединяются в общий баланс/);
  assert.match(page, /не конвертируются друг в друга/);
  assert.match(page, /не используют общий журнал операций/);
});

test("digital asset cards never fabricate chart history or event records", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /aria-label="График динамики ZHAKIN Points пока недоступен"/);
  assert.match(page, /aria-label="График динамики BFU пока недоступен"/);
  assert.match(page, /Исторические данные ещё не подключены/);
  assert.match(page, /Нет подтверждённого исторического ряда/);
  assert.match(page, /Журнал пока не подключён\. Записей нет\./);
  assert.match(page, /class="wallet-asset-meta"><span>Операции<\/span><strong>Отключены<\/strong>/);
});

test("digital asset event log is keyboard-accessible and horizontally scrollable", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /tabindex="0" role="region" aria-label="Таблица журнала событий"/);
  assert.match(page, /<th scope="col">Дата и время<\/th>/);
  assert.match(page, /<th scope="col">Система<\/th>/);
  assert.match(page, /<th scope="col">Событие<\/th>/);
  assert.match(page, /<th scope="col">Статус<\/th>/);
  assert.match(page, /\.wallet-event-table-wrap\{overflow-x:auto/);
  assert.match(page, /\.wallet-event-table\{width:100%;min-width:520px/);
});

test("digital asset cards collapse to one column on narrow screens", async () => {
  const page = await readFile(walletUrl, "utf8");
  assert.match(page, /\.wallet-assets-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(page, /@media\(max-width:720px\)\{\.wallet-assets-grid\{grid-template-columns:1fr\}/);
});
