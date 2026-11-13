import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const config = 'wrangler.test.jsonc';
const baseArgs = ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', config];

function runWrangler(args, { expectFailure = false } = {}) {
  try {
    return execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (expectFailure) return '';
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    throw new Error(`Wrangler command failed: ${[...args].join(' ')}\n${stderr}\n${stdout}`);
  }
}

runWrangler(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--yes']);

const seed = "INSERT INTO engagement_daily (event_day,event_type,path,content_id,referrer_class,event_count) VALUES ('2099-01-01','page_view','/d1-test.html','','other',1) ON CONFLICT(event_day,event_type,path,content_id,referrer_class) DO UPDATE SET event_count = event_count + 1;";
runWrangler([...baseArgs, '--command', seed]);
runWrangler([...baseArgs, '--command', seed]);

const output = runWrangler([...baseArgs, '--command', "SELECT event_count FROM engagement_daily WHERE event_day='2099-01-01' AND event_type='page_view' AND path='/d1-test.html' AND content_id='' AND referrer_class='other';", '--json']);
let payload;
try {
  payload = JSON.parse(output);
} catch {
  throw new Error(`Could not parse Wrangler JSON result: ${output}`);
}
const rows = Array.isArray(payload) ? payload.flatMap(item => item.results || []) : (payload.results || []);
assert.equal(rows.length, 1, 'expected exactly one aggregated row');
assert.equal(Number(rows[0].event_count), 2, 'duplicate events must increment one aggregate');

runWrangler([...baseArgs, '--command', "INSERT INTO engagement_daily (event_day,event_type,path,content_id,referrer_class,event_count) VALUES ('2099-01-02','page_view','/null-test.html',NULL,'other',1);"], { expectFailure: true });
const nullCheck = runWrangler([...baseArgs, '--command', "SELECT COUNT(*) AS count FROM engagement_daily WHERE event_day='2099-01-02';", '--json']);
let nullPayload;
try {
  nullPayload = JSON.parse(nullCheck);
} catch {
  throw new Error(`Could not parse Wrangler NULL-guard result: ${nullCheck}`);
}
const nullRows = Array.isArray(nullPayload) ? nullPayload.flatMap(item => item.results || []) : (nullPayload.results || []);
assert.equal(Number(nullRows[0]?.count), 0, 'NULL content_id must not be persisted');

console.log('PASS: local Cloudflare D1 migration, duplicate aggregation, and NOT NULL guard');
