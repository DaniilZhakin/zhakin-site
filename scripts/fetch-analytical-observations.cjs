#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'data/analytical-monitoring/observations.json');
const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const WORLD_BANK_URL = 'https://api.worldbank.org/v2/country/usa/indicator/GB.XPD.RSDV.GD.ZS?format=json&per_page=100';
const TIMEOUT_MS = 15000;

function parseRussianNumber(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseCbrXml(xml, retrievedAt) {
  if (typeof xml !== 'string' || !/<ValCurs\b/.test(xml)) {
    throw new Error('CBR response does not contain a ValCurs document');
  }
  const dateMatch = xml.match(/<ValCurs\b[^>]*\bDate="([^"]+)"/);
  if (!dateMatch) throw new Error('CBR response is missing the effective date');
  const [day, month, year] = dateMatch[1].split('.');
  if (!day || !month || !year) throw new Error('CBR effective date has an unexpected format');
  const effectiveDate = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  const wanted = new Set(['USD', 'EUR', 'CNY']);
  const observations = [];
  for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const block = match[1];
    const field = (name) => {
      const openTag = '<' + name + '>';
      const closeTag = '</' + name + '>';
      const start = block.indexOf(openTag);
      if (start < 0) return null;
      const valueStart = start + openTag.length;
      const end = block.indexOf(closeTag, valueStart);
      return end < 0 ? null : block.slice(valueStart, end).trim();
    };
    const code = field('CharCode');
    if (!wanted.has(code)) continue;
    const nominal = parseRussianNumber(field('Nominal'));
    const value = parseRussianNumber(field('Value'));
    if (!nominal || nominal <= 0 || value === null || value <= 0) {
      throw new Error('CBR returned an invalid rate for ' + code);
    }
    observations.push({
      indicator_id: 'macro.fx_official',
      series_key: 'RUB/' + code,
      value: value / nominal,
      unit: 'RUB_per_1_' + code,
      geography: 'currency_pair',
      reference_period: effectiveDate,
      source: { name: 'Bank of Russia', dataset: 'Daily official exchange rates', url: CBR_URL },
      source_release_date: effectiveDate,
      retrieved_at: retrievedAt,
      revision_status: 'source_published',
      validation_status: 'validated'
    });
  }
  if (observations.length !== wanted.size) {
    throw new Error('CBR response is missing one or more required currency series');
  }
  return observations;
}

function parseWorldBankJson(payload, retrievedAt) {
  if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[1])) {
    throw new Error('World Bank response has an unexpected JSON structure');
  }
  const rows = payload[1].filter((row) => row && row.value !== null && Number.isFinite(Number(row.value)) && /^\d{4}$/.test(String(row.date)));
  if (!rows.length) throw new Error('World Bank returned no non-null R&D observations for USA');
  rows.sort((a, b) => Number(b.date) - Number(a.date));
  const latest = rows[0];
  return [{
    indicator_id: 'tech.rd_gdp',
    series_key: 'USA/GB.XPD.RSDV.GD.ZS',
    value: Number(latest.value),
    unit: 'percent_GDP',
    geography: 'USA',
    reference_period: String(latest.date),
    source: {
      name: 'World Bank',
      dataset: 'World Development Indicators — Research and development expenditure (% of GDP)',
      url: WORLD_BANK_URL,
      indicator_code: 'GB.XPD.RSDV.GD.ZS',
      country_code: 'USA'
    },
    source_release_date: payload[0]?.lastupdated ?? null,
    retrieved_at: retrievedAt,
    revision_status: 'latest_available_source_vintage',
    validation_status: 'validated'
  }];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'ZHAKIN-TEAM-Analytical-Monitoring/1.0', accept: 'application/xml, application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('Source request failed (' + response.status + '): ' + url);
  return response.text();
}

async function collectObservations() {
  const retrievedAt = new Date().toISOString();
  const [cbrXml, wbText] = await Promise.all([fetchText(CBR_URL), fetchText(WORLD_BANK_URL)]);
  let wbPayload;
  try { wbPayload = JSON.parse(wbText); } catch { throw new Error('World Bank response is not valid JSON'); }
  const observations = [
    ...parseCbrXml(cbrXml, retrievedAt),
    ...parseWorldBankJson(wbPayload, retrievedAt)
  ];
  return {
    schema_version: '1.0.0',
    catalog_name: 'ZHAKIN TEAM Analytical Monitoring Observations',
    status: 'source_fetched_validated',
    generated_at: retrievedAt,
    source_count: 2,
    observation_count: observations.length,
    observations
  };
}

async function main() {
  const result = await collectObservations();
  if (process.argv.includes('--check')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write('Wrote ' + result.observation_count + ' validated observations to ' + path.relative(ROOT, OUTPUT) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write('Analytical data ingestion failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { parseRussianNumber, parseCbrXml, parseWorldBankJson };
