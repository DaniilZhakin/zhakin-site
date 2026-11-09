import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.PLATFORM_URL || "http://127.0.0.1:4173/platform.html";
const output = "artifacts/platform";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];

async function inspect(name, viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(`${name}: page error: ${error.message}`));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort();
  });
  const response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!response || !response.ok()) failures.push(`${name}: page response ${response?.status() ?? "missing"}`);
  await page.locator("#platform-grid .platform-card").first().waitFor({ state: "visible" });

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    cards: document.querySelectorAll("#platform-grid .platform-card").length,
    menuButton: Boolean(document.querySelector(".menu-toggle")),
    navigation: Boolean(document.querySelector("#site-navigation"))
  }));
  if (layout.cards !== 8) failures.push(`${name}: expected 8 cards, found ${layout.cards}`);
  if (!layout.menuButton || !layout.navigation) failures.push(`${name}: navigation controls missing`);
  if (layout.documentWidth > layout.viewportWidth + 1) failures.push(`${name}: horizontal overflow ${layout.documentWidth}px > ${layout.viewportWidth}px`);
  await page.screenshot({ path: `${output}/platform-${name}-top.png`, fullPage: false, animations: "disabled" });

  if (mobile) {
    const menu = page.locator("#site-navigation");
    const button = page.locator(".menu-toggle");
    await button.click();
    if (await button.getAttribute("aria-expanded") !== "true") failures.push(`${name}: menu did not set aria-expanded=true`);
    if (!(await menu.evaluate(el => el.classList.contains("active")))) failures.push(`${name}: menu did not open`);
    const menuMetrics = await menu.evaluate(el => ({
      top: Math.round(el.getBoundingClientRect().top),
      bottom: Math.round(el.getBoundingClientRect().bottom),
      height: Math.round(el.getBoundingClientRect().height),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY
    }));
    if (menuMetrics.overflowY !== "auto") failures.push(`${name}: menu is not vertically scrollable`);
    if (menuMetrics.bottom > viewport.height + 1) failures.push(`${name}: menu extends below viewport`);
    await menu.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(100);
    const lastLinkVisible = await menu.locator("a").last().evaluate(el => {
      const r = el.getBoundingClientRect();
      const parent = el.closest("nav").getBoundingClientRect();
      return r.bottom <= parent.bottom + 1 && r.top >= parent.top - 1;
    });
    if (!lastLinkVisible) failures.push(`${name}: last navigation link cannot be scrolled into view`);
    await page.screenshot({ path: `${output}/platform-${name}-menu.png`, fullPage: false, animations: "disabled" });
    await button.click();
    if (await button.getAttribute("aria-expanded") !== "false") failures.push(`${name}: menu did not close on second tap`);
  }

  const search = page.locator("#platform-search");
  await search.fill("Wallet");
  const visibleAfterSearch = await page.locator("#platform-grid .platform-card:visible").count();
  if (visibleAfterSearch !== 1) failures.push(`${name}: Wallet search expected 1 card, found ${visibleAfterSearch}`);
  await search.fill("");
  await page.locator('[data-filter="knowledge"]').click();
  const visibleKnowledge = await page.locator("#platform-grid .platform-card:visible").count();
  if (visibleKnowledge !== 1) failures.push(`${name}: analytics filter expected 1 card, found ${visibleKnowledge}`);
  await page.locator('[data-filter="all"]').click();
  const visibleAll = await page.locator("#platform-grid .platform-card:visible").count();
  if (visibleAll !== 8) failures.push(`${name}: all filter expected 8 cards, found ${visibleAll}`);
  await page.locator("#platform-catalog").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/platform-${name}-catalog.png`, fullPage: false, animations: "disabled" });

  console.log(JSON.stringify({ name, ...layout, ...(mobile ? { menuMetrics } : {}), visibleAfterSearch, visibleKnowledge, visibleAll }));
  await context.close();
}

try {
  await inspect("desktop-1440x1000", { width: 1440, height: 1000 });
  await inspect("iphone-390x844", { width: 390, height: 844 }, true);
  await inspect("iphone-short-375x667", { width: 375, height: 667 }, true);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(failures.join("\\n"));
  process.exitCode = 1;
}
