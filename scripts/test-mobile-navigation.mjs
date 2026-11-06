import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../assets/css/style.css", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

test("mobile navigation is bounded by the visible viewport", () => {
  const mobile = css.match(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.main-navigation\s*\{([^}]*)\}/);
  assert.ok(mobile, "mobile navigation rule must exist inside the <=700px media query");
  assert.match(mobile[1], /max-height:\s*calc\(100vh\s*-\s*110px\)/);
  assert.match(mobile[1], /max-height:\s*calc\(100dvh\s*-\s*110px\)/);
});

test("mobile navigation scrolls independently on touch devices", () => {
  const mobile = css.match(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.main-navigation\s*\{([^}]*)\}/);
  assert.ok(mobile, "mobile navigation rule must exist");
  assert.match(mobile[1], /overflow-y:\s*auto/);
  assert.match(mobile[1], /overscroll-behavior:\s*contain/);
  assert.match(mobile[1], /-webkit-overflow-scrolling:\s*touch/);
});

test("mobile navigation retains explicit closed and opened states", () => {
  assert.match(css, /\.main-navigation\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.main-navigation\.active\s*\{\s*display:\s*flex/);
});

test("Escape closes navigation and restores focus to its trigger", () => {
  assert.match(mainJs, /event\.key !== 'Escape'/);
  assert.match(mainJs, /setMenuState\(false\);\s*menuButton\?\.focus\(\)/);
});

test("desktop breakpoint resets the mobile navigation disclosure state", () => {
  assert.match(mainJs, /matchMedia\('\(min-width: 1001px\)'\)/);
  assert.match(mainJs, /if \(event\.matches\) setMenuState\(false\)/);
});
