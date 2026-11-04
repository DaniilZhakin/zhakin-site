import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const target = process.env.WALLET_URL || "https://xn--80alhhq.xn--p1ai/wallet.html";
const output = "artifacts/wallet";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];

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
  await page.screenshot({ path: `${output}/wallet-${name}.png`, fullPage: true, animations: "disabled" });
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
