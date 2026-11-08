const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "..", "assets/js/main.js"), "utf8");

test("Escape closes an open navigation menu and returns focus to its toggle", () => {
  assert.match(js, /event\.key !== 'Escape' \|\| !navigation\?\.classList\.contains\('active'\)/);
  assert.match(js, /event\.preventDefault\(\);\s*setMenuState\(false\);\s*menuButton\?\.focus\(\);/);
});
