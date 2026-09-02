import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

// Privacy-by-design regression gate: the collector must not read or persist
// network/device identifiers or raw form/contact content.
assert.equal(worker.includes('cf-connecting-ip'), false);
assert.equal(worker.includes('CF-Connecting-IP'), false);
assert.equal(worker.includes('user-agent'), false);
assert.equal(worker.includes('authorization'), false);
assert.equal(worker.includes('cookie'), false);
assert.equal(worker.includes('localStorage'), false);
assert.equal(worker.includes('fingerprint'), true); // policy comment documents the prohibition
assert.equal(worker.includes('raw form content'), true); // policy comment documents the prohibition

// Persistence must remain limited to the approved aggregate fields.
assert.match(worker, /INSERT INTO engagement_daily/);
assert.match(worker, /event_day, event_type, path, content_id, referrer_class, event_count/);
assert.equal(worker.includes('request.headers.get(\'Origin\')'), true);

console.log('PASS: Cloudflare collector privacy contract gate');
