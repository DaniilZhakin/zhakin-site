const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(
  require("node:path").join(__dirname, "../assets/js/wallet-markets.js"),
  "utf8"
);

test("safeNumber preserves missing values and accepts real numeric zero", () => {
  const match = source.match(/const safeNumber = \(value\) => \{[\s\S]*?\n  \};/);
  assert.ok(match, "safeNumber implementation must exist in the market module");
  const safeNumber = vm.runInNewContext(`(${match[0].replace(/^const safeNumber = /, "").replace(/;$/, "")})`);

  assert.equal(safeNumber(null), null);
  assert.equal(safeNumber(undefined), null);
  assert.equal(safeNumber(""), null);
  assert.equal(safeNumber("   "), null);
  assert.equal(safeNumber("0"), 0);
  assert.equal(safeNumber(0), 0);
  assert.equal(safeNumber("12.5"), 12.5);
  assert.equal(safeNumber("not-a-number"), null);
  assert.equal(safeNumber(Infinity), null);
});

test("Bybit missing 24h percentage remains null instead of becoming zero", () => {
  assert.match(
    source,
    /const changeRaw = safeNumber\(q\.price24hPcnt\);\s*return \{[^}]*change: changeRaw === null \? null : changeRaw \* 100/
  );
});
