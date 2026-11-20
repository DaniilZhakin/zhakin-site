const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'centers/analytical/index.html');
const html = fs.readFileSync(pagePath, 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const directory = fs.readFileSync(path.join(root, 'centers/index.html'), 'utf8');

test('Analytical Center page has canonical metadata and Russian language declaration', () => {
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<title>Аналитический центр — ZHAKIN TEAM<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/xn--80alhhq\.xn--p1ai\/centers\/analytical\//);
  assert.match(html, /"@type":"CollectionPage"/);
});

test('Analytical Center exposes four defined research directions', () => {
  for (const label of ['Экономика, финансы и инвестиции', 'Международная торговля и продовольствие', 'ИИ, технологии и промышленность', 'Инфраструктура, безопасность и устойчивость']) {
    assert.ok(html.includes(label), 'Missing research direction: ' + label);
  }
  assert.match(html, /Research protocol/);
  assert.match(html, /01 · Вопрос/);
  assert.match(html, /02 · Данные/);
  assert.match(html, /03 · Метод/);
  assert.match(html, /04 · Вывод/);
});

test('Selected publication links are present in sitemap', () => {
  const links = [...html.matchAll(/href="(\/publications\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(links.length >= 6, 'Expected at least six selected publication links');
  for (const link of links) {
    assert.ok(sitemap.includes('https://xn--80alhhq.xn--p1ai' + link), 'Missing sitemap URL: ' + link);
  }
});

test('Expert centers directory links to the public Analytical Center', () => {
  assert.match(directory, /href="\/centers\/analytical\/">Открыть аналитический центр/);
  assert.ok(sitemap.includes('https://xn--80alhhq.xn--p1ai/centers/analytical/'));
});

test('Page discloses its scope and does not present itself as a licensed service', () => {
  assert.match(html, /не является заявлением о наличии лицензии/);
  assert.match(html, /не являются индивидуальной инвестиционной рекомендацией/);
});

test('Mobile navigation has an explicit open state and accessible controls', () => {
  const mainJs = fs.readFileSync(path.join(root, 'assets/js/main.js'), 'utf8');
  const stylesheet = fs.readFileSync(path.join(root, 'assets/css/style.css'), 'utf8');
  assert.match(html, /class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
  assert.match(html, /id="site-navigation" class="main-navigation"/);
  assert.match(mainJs, /menuButton\.addEventListener\('click'/);
  assert.match(mainJs, /navigation\.classList\.toggle\('active', isOpen\)/);
  assert.match(mainJs, /menuButton\.setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(mainJs, /event\.key === 'Escape'/);
  assert.match(stylesheet, /@media\s*\(max-width:\s*700px\)/);
  assert.match(stylesheet, /\.main-navigation\.active\s*\{\s*display:flex/);
  assert.match(stylesheet, /-webkit-overflow-scrolling:touch/);
});

const monitoringPath = path.join(root, 'centers/analytical/monitoring.html');
const monitoring = fs.readFileSync(monitoringPath, 'utf8');

test('Monitoring framework has canonical metadata and all three monitoring domains', () => {
  assert.match(monitoring, /<html lang="ru">/);
  assert.match(monitoring, /centers\/analytical\/monitoring\.html/);
  for (const section of ['Макроэкономический мониторинг', 'Международная торговля и продовольствие', 'Технологический мониторинг']) {
    assert.ok(monitoring.includes(section), 'Missing monitoring section: ' + section);
  }
});

test('Monitoring indicators document units, sources and calculation rules without fabricated live values', () => {
  for (const source of ['Росстат', 'Банк России', 'UN Comtrade', 'FAOSTAT', 'International Federation of Robotics', 'World Bank']) {
    assert.ok(monitoring.includes(source), 'Missing primary data source: ' + source);
  }
  assert.match(monitoring, /Метод расчёта и контроль/);
  assert.match(monitoring, /ИСТОРИЯ НАБЛЮДЕНИЙ ФОРМИРУЕТСЯ/);
  assert.match(monitoring, /значение не подменяется оценкой/);
});

test('Monitoring page is linked from the Analytical Center and included in sitemap', () => {
  assert.match(html, /href="\/centers\/analytical\/monitoring\.html"/);
  assert.ok(sitemap.includes('https://xn--80alhhq.xn--p1ai/centers/analytical/monitoring.html'));
});

const registryPath = path.join(root, 'data/analytical-monitoring/indicators.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

test('Indicator registry is machine-readable, scoped as catalog-only and contains no fabricated observations', () => {
  assert.equal(registry.schema_version, '1.0.0');
  assert.equal(registry.status, 'catalog_only');
  assert.equal(registry.policy.observations_included, false);
  assert.equal(registry.policy.live_data_connected, false);
  assert.equal(Array.isArray(registry.indicators), true);
  assert.equal(registry.indicators.length, 16);
  assert.equal(Object.hasOwn(registry, 'observations'), false);
});

test('Every registry indicator has a unique ID, source, unit, frequency, method and validation controls', () => {
  const ids = new Set();
  for (const indicator of registry.indicators) {
    assert.ok(indicator.id && !ids.has(indicator.id), 'Missing or duplicate indicator ID: ' + indicator.id);
    ids.add(indicator.id);
    assert.ok(['macro', 'trade', 'technology'].includes(indicator.domain), 'Invalid domain: ' + indicator.domain);
    assert.ok(indicator.title && indicator.unit && indicator.frequency);
    assert.ok(indicator.source?.name && /^https:\/\//.test(indicator.source.url));
    assert.ok(indicator.method && indicator.validation?.length);
  }
  assert.deepEqual([...new Set(registry.indicators.map(item => item.domain))].sort(), ['macro', 'technology', 'trade']);
});

test('Monitoring page links to the structured indicator registry and explains its current status', () => {
  assert.match(monitoring, /href="\/data\/analytical-monitoring\/indicators\.json"/);
  assert.match(monitoring, /каталог методик/);
  assert.match(monitoring, /16 индикаторов/);
});

const observationsPath = path.join(root, 'data/analytical-monitoring/observations.json');
const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8'));

test('Published observations snapshot contains only validated, sourced and timestamped records', () => {
  assert.equal(observations.schema_version, '1.0.0');
  assert.equal(observations.status, 'source_fetched_validated');
  assert.equal(observations.observation_count, 4);
  assert.equal(observations.observations.length, 4);
  for (const row of observations.observations) {
    assert.ok(row.indicator_id && row.series_key && Number.isFinite(row.value));
    assert.ok(row.unit && row.geography && row.reference_period);
    assert.ok(row.source?.name && row.source.url.startsWith('https://'));
    assert.ok(row.retrieved_at && row.source_release_date);
    assert.equal(row.validation_status, 'validated');
  }
});

test('First snapshot values match the monitoring cards and preserve distinct reference periods', () => {
  const expected = new Map([
    ['RUB/USD', 81.929],
    ['RUB/EUR', 89.8597],
    ['RUB/CNY', 12.2546],
    ['USA/GB.XPD.RSDV.GD.ZS', 3.44716]
  ]);
  for (const [key, value] of expected) {
    assert.equal(observations.observations.find((row) => row.series_key === key)?.value, value);
  }
  assert.equal(observations.observations.find((row) => row.series_key === 'USA/GB.XPD.RSDV.GD.ZS').reference_period, '2023');
  assert.match(monitoring, /81,9290/);
  assert.match(monitoring, /89,8597/);
  assert.match(monitoring, /12,2546/);
  assert.match(monitoring, /3,44716%/);
  assert.match(monitoring, /20\.11\.2026/);
});

test('FX history visualization uses only validated observations and exposes accessible series controls', () => {
  const chartScript = fs.readFileSync(path.join(root, 'assets/js/analytical-monitoring-charts.js'), 'utf8');
  const history = JSON.parse(fs.readFileSync(path.join(root, 'data/analytical-monitoring/history.json'), 'utf8'));
  assert.equal(history.status, 'history_accumulating');
  assert.equal(history.observations.length, 4);
  assert.match(monitoring, /id="fx-history"/);
  assert.match(monitoring, /data-series="RUB\\/USD"/);
  assert.match(monitoring, /aria-pressed="true"/);
  assert.match(monitoring, /Исторические точки не моделируются/);
  assert.match(chartScript, /points\.length < 2/);
  assert.match(chartScript, /validation_status === 'validated'/);
  assert.match(chartScript, /history\.json/);
});

test('Monitoring page describes the real automation boundary without claiming an active schedule on the feature branch', () => {
  assert.match(monitoring, /расписание начнёт работать после включения workflow в основную ветку/);
  assert.match(monitoring, /загрузчик Банка России и Всемирного банка подключён/);
});
