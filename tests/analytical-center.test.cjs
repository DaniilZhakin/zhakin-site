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
  assert.equal(observations.observation_count, 76);
  assert.equal(observations.observations.length, 76);
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
    ['RUB/USD', 82.1265],
    ['RUB/EUR', 89.8053],
    ['RUB/CNY', 12.3184],
    ['USA/GB.XPD.RSDV.GD.ZS', 3.44716],
    ['CHN/GB.XPD.RSDV.GD.ZS', 2.57729],
    ['DEU/GB.XPD.RSDV.GD.ZS', 3.1539],
    ['JPN/GB.XPD.RSDV.GD.ZS', 3.44125],
    ['KOR/GB.XPD.RSDV.GD.ZS', 4.94352],
    ['GBR/GB.XPD.RSDV.GD.ZS', 2.67614],
    ['FRA/GB.XPD.RSDV.GD.ZS', 2.17832],
    ['RUS/GB.XPD.RSDV.GD.ZS', 0.93706]
  ]);
  const latestBySeries = new Map();
  for (const row of observations.observations) {
    const previous = latestBySeries.get(row.series_key);
    if (!previous || row.reference_period > previous.reference_period) latestBySeries.set(row.series_key, row);
  }
  for (const [key, value] of expected) {
    assert.equal(latestBySeries.get(key)?.value, value);
  }
  assert.equal(latestBySeries.get('USA/GB.XPD.RSDV.GD.ZS').reference_period, '2023');
  assert.match(monitoring, /82,1265/);
  assert.match(monitoring, /89,8053/);
  assert.match(monitoring, /12,3184/);
  assert.match(monitoring, /3,44716%/);
  assert.match(monitoring, /26\.11\.2026/);
});

test('FX history visualization uses only validated observations and exposes accessible series controls', () => {
  const chartScript = fs.readFileSync(path.join(root, 'assets/js/analytical-monitoring-charts.js'), 'utf8');
  const history = JSON.parse(fs.readFileSync(path.join(root, 'data/analytical-monitoring/history.json'), 'utf8'));
  assert.equal(history.status, 'history_accumulating');
  assert.ok(history.observations.length > 0);\n  assert.equal(history.observations.length, history.observations.filter(row => row.validation_status === 'validated').length);
  assert.match(monitoring, /id="fx-history"/);
  assert.match(monitoring, /data-series="RUB\/USD"/);
  assert.match(monitoring, /aria-pressed="true"/);
  assert.match(monitoring, /Исторические точки не моделируются/);
  assert.match(chartScript, /points\.length < 2/);
  assert.match(chartScript, /validation_status === 'validated'/);
  assert.match(chartScript, /history\.json/);
});

test('Monitoring page describes the real automation boundary without claiming an active schedule on the feature branch', () => {
  assert.match(monitoring, /расписание начнёт работать после включения workflow в основную ветку/);
  assert.match(monitoring, /Загрузчик Банка России и Всемирного банка подключён/);
});

test('R&D country comparison panel renders only validated World Bank observations and discloses year coverage', () => {
  const comparisonScript = fs.readFileSync(path.join(root, 'assets/js/analytical-rd-comparison.js'), 'utf8');
  assert.match(monitoring, /id="rd-comparison"/);
  assert.match(monitoring, /GB\.XPD\.RSDV\.GD\.ZS/);
  assert.match(monitoring, /Единый общий год/);
  assert.match(monitoring, /Последнее доступное по стране/);
  assert.match(comparisonScript, /validation_status === 'validated'/);
  assert.match(comparisonScript, /reference_period/);
  assert.match(comparisonScript, /source_release_date/);
  assert.match(comparisonScript, /latestCommonYear/);
  assert.match(comparisonScript, /periodSelect\.addEventListener\('change', render\)/);
  assert.match(comparisonScript, /USA.*CHN.*DEU.*JPN.*KOR.*GBR.*FRA.*RUS/);
  assert.match(comparisonScript, /Пропуски не заменяются оценками/);
});


test('R&D comparison snapshot covers eight countries with sourced values and explicit years', () => {
 const rows = observations.observations.filter(row => row.indicator_id === 'tech.rd_gdp');
 const latest = new Map();
 for (const row of rows) {
   const previous = latest.get(row.geography);
   if (!previous || row.reference_period > previous.reference_period) latest.set(row.geography, row);
 }
 const latestRows = [...latest.values()];
 assert.equal(latestRows.length, 8);
 assert.deepEqual(latestRows.map(row => row.geography).sort(), ['CHN','DEU','FRA','GBR','JPN','KOR','RUS','USA']);
 assert.ok(latestRows.every(row => row.unit === 'percent_GDP' && row.country_name && row.source.indicator_code === 'GB.XPD.RSDV.GD.ZS'));
 assert.equal(latestRows.find(row => row.geography === 'RUS').reference_period, '2024');
 assert.ok(latestRows.filter(row => row.geography !== 'RUS').every(row => row.reference_period === '2023'));
});


test('executive dashboard exposes sourced FX cards and comparable R&D chart', () => {
  assert.match(html, /data-fx-cards/);
  assert.match(html, /data-rd-chart/);
  assert.match(html, /analytical-overview-dashboard\.js/);
  const dashboard = fs.readFileSync(path.join(root, 'assets/js/analytical-overview-dashboard.js'), 'utf8');
  assert.match(dashboard, /validation_status === 'validated'/);
  assert.match(dashboard, /cache: 'no-store'/);
});


test('Monitoring coverage dashboard exposes validated observation, indicator and country coverage tables', () => {
  const page = fs.readFileSync(path.join(root, 'centers/analytical/monitoring.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'assets/js/analytical-data-coverage.js'), 'utf8');
  assert.match(page, /data-coverage-dashboard/);
  assert.match(page, /data-coverage-kpis/);
  assert.match(page, /data-coverage-rows/);
  assert.match(page, /data-coverage-geographies/);
  assert.match(page, /analytical-data-coverage\.js/);
  assert.match(script, /source_fetched_validated/);
  assert.match(script, /validation_status === 'validated'/);
  assert.ok(script.includes('https:'));
  assert.match(script, /data-coverage-kpis/);
  assert.match(script, /data-coverage-rows/);
  assert.match(script, /data-coverage-geographies/);
  assert.match(script, /cache: 'no-store'/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML|eval/);
});

test('Coverage dashboard reports counts from the published snapshot without inventing missing years', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/analytical-monitoring/observations.json'), 'utf8'));
  const validated = snapshot.observations.filter(row => row.validation_status === 'validated' &&
    row.source && row.source.url.startsWith('https://'));
  const countries = new Set(validated.filter(row => row.indicator_id === 'tech.rd_gdp').map(row => row.geography));
  const sources = new Set(validated.map(row => row.source.name));
  assert.equal(validated.length, snapshot.observation_count);
  assert.equal(countries.size, 8);
  assert.ok(sources.has('World Bank'));
  assert.ok(sources.has('Bank of Russia'));
  assert.match(fs.readFileSync(path.join(root, 'centers/analytical/monitoring.html'), 'utf8'), /Пропущенные годы не интерполируются/);
});


test('FX history chart exposes period movement, latest value and accessible point-level details', () => {
  const chartScript = fs.readFileSync(path.join(root, 'assets/js/analytical-monitoring-charts.js'), 'utf8');
  assert.match(chartScript, /accessibleDescription\(/);
  assert.match(chartScript, /aria-label/);
  assert.match(chartScript, /node\('title'/);
  assert.match(chartScript, /node\('desc'/);
  assert.match(chartScript, /Последнее значение:/);
  assert.match(chartScript, /изменение за период/);
  assert.match(chartScript, /chart-point-latest/);
  assert.match(chartScript, /point\.retrieved_at/);
  assert.match(chartScript, /validation_status === 'validated'/);
});
