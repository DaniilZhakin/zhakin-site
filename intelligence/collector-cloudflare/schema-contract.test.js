import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = JSON.parse(
  fs.readFileSync(new URL('../../docs/intelligence-3.0-collector-contract.schema.json', import.meta.url), 'utf8'),
);

assert.equal(schema.type, 'object');
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, ['event_type', 'path', 'schema_version']);
assert.equal(schema.properties.schema_version.const, '3.0');
assert.deepEqual(schema.properties.event_type.enum, [
  'page_view',
  'navigation_click',
  'menu_toggle',
  'outbound_click',
  'contact_interest',
  'contact_action',
]);
assert.deepEqual(schema.properties.referrer_class.enum, [
  'internal',
  'search',
  'social',
  'direct',
  'other',
]);
assert.deepEqual(Object.keys(schema.properties).sort(), [
  'content_id',
  'event_type',
  'path',
  'referrer_class',
  'schema_version',
  'timestamp',
]);
assert.equal(schema.properties.path.maxLength, 512);
assert.equal(schema.properties.path.pattern, '^/[^?#]*$');
assert.equal(schema.properties.timestamp.format, 'date-time');
assert.equal(schema.properties.timestamp.maxLength, 64);
assert.equal(schema.properties.referrer_class.maxLength, 32);
assert.equal(schema.properties.content_id.pattern, '^[A-Za-z0-9._-]+$');
assert.equal(schema.properties.content_id.maxLength, 128);

console.log('PASS: Cloudflare collector schema drift gate');
