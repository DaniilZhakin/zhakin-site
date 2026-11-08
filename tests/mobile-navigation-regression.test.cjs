const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets/css/style.css"), "utf8");
const js = fs.readFileSync(path.join(root, "assets/js/main.js"), "utf8");

test("mobile navigation has a viewport-bounded scroll container", () => {
  const mobileBlock = css.match(/@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobileBlock, "mobile breakpoint must exist");
  const block = mobileBlock[1];
  assert.match(block, /\.main-navigation\s*\{[\s\S]*?max-height:\s*calc\(100vh\s*-\s*112px\)/);
  assert.match(block, /max-height:\s*calc\(100dvh\s*-\s*112px\)/);
  assert.match(block, /overflow-y:\s*auto/);
  assert.match(block, /overscroll-behavior:\s*contain/);
  assert.match(block, /-webkit-overflow-scrolling:\s*touch/);
});

test("mobile navigation respects iPhone safe-area inset", () => {
  const mobileBlock = css.match(/@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobileBlock);
  assert.match(mobileBlock[1], /padding-bottom:\s*calc\(24px\s*\+\s*env\(safe-area-inset-bottom/);
});

test("menu state is exposed accessibly and links close the menu", () => {
  assert.match(js, /navigation\.classList\.toggle\('active',\s*isOpen\)/);
  assert.match(js, /menuButton\.setAttribute\('aria-expanded',\s*String\(isOpen\)\)/);
  assert.match(js, /if\s*\(navigation\?\.classList\.contains\('active'\)\)\s*setMenuState\(false\)/);
});
