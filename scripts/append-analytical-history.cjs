#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'data/analytical-monitoring/observations.json');
const HISTORY = path.join(ROOT, 'data/analytical-monitoring/history.json');

function observationKey(row) {
  return [row.series_key, row.reference_period, row.source_release_date, row.value, row.revision_status].join('|');
}
function mergeHistory(history, snapshot) {
  const existing = Array.isArray(history.observations) ? history.observations : [];
  const seen = new Set(existing.map(observationKey));
  const additions = (snapshot.observations || []).filter(row => {
    if (row.validation_status !== 'validated' || !Number.isFinite(Number(row.value))) return false;
    const key = observationKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    schema_version: '1.0.0',
    catalog_name: 'ZHAKIN TEAM Analytical Monitoring History',
    status: 'history_accumulating',
    generated_at: additions.length ? snapshot.generated_at : (history.generated_at || snapshot.generated_at),
    observations: [...existing, ...additions].sort((a, b) =>
      String(a.reference_period).localeCompare(String(b.reference_period)) ||
      String(a.series_key).localeCompare(String(b.series_key)) ||
      String(a.retrieved_at).localeCompare(String(b.retrieved_at)))
  };
}
function main() {
  if (!fs.existsSync(SNAPSHOT)) throw new Error('Validated observations snapshot is missing');
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  if (snapshot.status !== 'source_fetched_validated' || !Array.isArray(snapshot.observations)) {
    throw new Error('Snapshot is not a validated observation set');
  }
  const history = fs.existsSync(HISTORY)
    ? JSON.parse(fs.readFileSync(HISTORY, 'utf8'))
    : { schema_version: '1.0.0', observations: [] };
  const merged = mergeHistory(history, snapshot);
  if (JSON.stringify(merged) === JSON.stringify(history)) {
    process.stdout.write('No new validated history observations.\n');
    return;
  }
  fs.writeFileSync(HISTORY, JSON.stringify(merged, null, 2) + '\n');
  process.stdout.write('History now contains ' + merged.observations.length + ' validated observations.\n');
}
if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write('Analytical history update failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
module.exports = { observationKey, mergeHistory };
