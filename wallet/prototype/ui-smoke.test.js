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
