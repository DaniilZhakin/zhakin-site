import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../docs/intelligence-3.0-collector-contract.schema.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

const implementationEvents = [
  'page_view',
  'navigation_click',
  'menu_toggle',
  'outbound_click',
  'contact_interest',
  'contact_action',
];

const implementationFields = [
  'event_type',
  'path',
  'timestamp',
  'referrer_class',
  'content_id',
  'schema_version',
];

const implementationReferrers = [
  'internal',
  'search',
  'social',
  'direct',
  'other',
];

assert.equal(schema.type, 'object', 'schema root must be an object');
assert.equal(schema.additionalProperties, false, 'schema must reject unknown fields');
assert.deepEqual(schema.required, ['event_type', 'path', 'schema_version'], 'required fields drifted');
assert.equal(schema.properties.schema_version.const, '3.0', 'schema version drifted');
assert.deepEqual(schema.properties.event_type.enum, implementationEvents, 'event types drifted');
assert.deepEqual(schema.properties.referrer_class.enum, implementationReferrers, 'referrer classes drifted');
assert.deepEqual(Object.keys(schema.properties).sort(), [...implementationFields].sort(), 'allow-listed fields drifted');
assert.equal(schema.properties.path.pattern, '^/[^?#]*$', 'path validation drifted');
assert.equal(schema.properties.path.maxLength, 512, 'path max length drifted');
assert.equal(schema.properties.timestamp.format, 'date-time', 'timestamp format drifted');
assert.equal(schema.properties.timestamp.maxLength, 64, 'timestamp max length drifted');
assert.equal(schema.properties.referrer_class.maxLength, 32, 'referrer class max length drifted');
assert.equal(schema.properties.content_id.pattern, '^[A-Za-z0-9._-]+$', 'content id validation drifted');
assert.equal(schema.properties.content_id.maxLength, 128, 'content id max length drifted');

console.log('PASS: published collector schema remains aligned with the frozen 3.0 implementation contract');
