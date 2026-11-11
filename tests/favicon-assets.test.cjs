const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "favicon.svg"), "utf8");
const png = fs.readFileSync(path.join(root, "favicon-120.png"));
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("favicon uses the approved full emblem artwork", () => {
  assert.match(svg, /aria-label="Эмблема Жакин/);
  assert.match(svg, /href="\/favicon-48\.png"/);
  assert.match(index, /href="\/favicon-48\.png"/);
});

test("search-compatible PNG favicon is a valid 120 by 120 PNG", () => {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 120);
  assert.equal(png.readUInt32BE(20), 120);
});
