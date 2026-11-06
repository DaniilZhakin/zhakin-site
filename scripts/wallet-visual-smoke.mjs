import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const target = process.env.WALLET_URL || "https://xn--80alhhq.xn--p1ai/wallet.html";
const output = "artifacts/wallet";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const sections = [
  ["overview", ".wallet-dashboard", "Обзор кошелька"],
  ["card", ".wallet-card", "ZHAKIN POINTS"],
  ["planned", ".wallet-planned", "План развития"],
  ["collection", ".wallet-collection", "Кошельки и возможности"],
  ["history", ".wallet-section[aria-labelledby='history-title']", "История операций"],
  ["roadmap", ".wallet-section[aria-labelledby='roadmap-title']", "Архитектура запуска"]
];

async function inspect(name, viewport, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(`${name}: page error: ${error.message}`));
  const response = await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
  if (!response || !response.ok()) failures.push(`${name}: page response ${response?.status() ?? "missing"}`);
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });
  const title = (await page.locator("h1").first().innerText()).trim();
  if (!/ZHAKIN Wallet/i.test(title)) failures.push(`${name}: unexpected page heading: ${title}`);

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    walletVisible: Boolean(document.querySelector(".wallet-page")),
    mainVisible: Boolean(document.querySelector("main"))
  }));
  if (!layout.walletVisible || !layout.mainVisible) failures.push(`${name}: wallet/main container missing`);
  if (layout.documentWidth > layout.viewportWidth + 1) failures.push(`${name}: horizontal overflow ${layout.documentWidth}px > ${layout.viewportWidth}px`);

  // Capture each lazy-rendered region only after scrolling it into the viewport.
  // Full-page captures can preserve content-visibility intrinsic placeholders,
  // making real content look blank even when the page has rendered correctly.
  await page.screenshot({ path: `${output}/wallet-${name}-top.png`, animations: "disabled" });
  for (const [key, selector, expectedText] of sections) {
    const locator = page.locator(selector).first();
    if (await locator.count() !== 1) {
      failures.push(`${name}: missing section ${key}`);
      continue;
    }
    await locator.scrollIntoViewIfNeeded();
    await locator.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(180);
    const details = await locator.evaluate(element => ({
      text: (element.innerText || "").replace(/\\s+/g, " ").trim(),
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height)
    }));
    if (!details.text.includes(expectedText)) failures.push(`${name}: ${key} content missing expected text "${expectedText}"`);
    if (details.width < 1 || details.height < 1) failures.push(`${name}: ${key} has empty geometry`);
    await locator.screenshot({ path: `${output}/wallet-${name}-${key}.png`, animations: "disabled" });
    console.log(JSON.stringify({ name, section: key, ...details }));
  }

  console.log(JSON.stringify({ name, url: page.url(), heading: title, ...layout }));
  await context.close();
}

try {
  await inspect("desktop", { width: 1440, height: 1000 });
  await inspect("iphone-390x844", { width: 390, height: 844 }, true);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(failures.join("\\n"));
  process.exitCode = 1;
}
