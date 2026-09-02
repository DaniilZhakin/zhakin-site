import fs from 'node:fs';

const configPath = new URL('./wrangler.jsonc', import.meta.url);
const config = fs.readFileSync(configPath, 'utf8');

const placeholder = 'REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID';
if (config.includes(placeholder)) {
  console.error('PRODUCTION CONFIG BLOCKED: wrangler.jsonc still contains the D1 database_id placeholder.');
  process.exit(1);
}

const d1Ids = [...config.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
if (d1Ids.length === 0 || d1Ids.some((id) => !/^[0-9a-f]{32}$/i.test(id))) {
  console.error('PRODUCTION CONFIG BLOCKED: a valid 32-character hexadecimal Cloudflare D1 database_id is required.');
  process.exit(1);
}

if (config.includes('example.com') || config.includes('localhost')) {
  console.error('PRODUCTION CONFIG BLOCKED: example/localhost endpoint detected in production configuration.');
  process.exit(1);
}

console.log('PASS: production configuration contains a concrete D1 database_id and no placeholder endpoint.');
