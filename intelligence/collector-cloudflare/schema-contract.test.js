import assert from 'node:assert/strict';
import fs from 'node:fs';
import assertSql from 'node:assert/strict';

const schema = JSON.parse(
  fs.readFileSync(new URL('../../docs/intelligence-3.0-collector-contract.schema.json', import.meta.url), 'utf8'),
);

assert.equal(schema.type, 'object');
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, ['event_type', 'path', 'schema_version']);
assert.equal(schema.properties.schema_version.const, '3.0');
assert.deepEqual(schema.properties.event_type.enum, [
  'page_view',
  'navigation',
  'menu_interaction',
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


const migration = fs.readFileSync(new URL('./migrations/0000_create_engagement_daily.sql', import.meta.url), 'utf8');
assertSql.match(migration, /content_id TEXT NOT NULL DEFAULT ''/);
assertSql.match(migration, /ON CONFLICT/); // Schema and aggregation contract must preserve a stable key for events without content_id.

console.log('PASS: Cloudflare collector schema drift gate');
