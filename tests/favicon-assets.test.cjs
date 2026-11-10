const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "favicon.svg"), "utf8");
const png = fs.readFileSync(path.join(root, "favicon-48.png"));
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("favicon retains the shield and includes the requested reptile mark", () => {
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /id="reptile-mark"/);
  assert.match(svg, /<ellipse cx="32" cy="19\.5"/);
});

test("search-compatible PNG favicon is a valid 48 by 48 PNG", () => {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 48);
  assert.equal(png.readUInt32BE(20), 48);
});

test("homepage references both raster and vector favicon assets", () => {
  assert.match(index, /href="\/favicon-48\.png"/);
  assert.match(index, /href="\/favicon\.svg"/);
});
