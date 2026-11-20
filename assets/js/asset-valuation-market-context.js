(function (root) {
  'use strict';
  const KEYS = ['RUB/USD', 'RUB/EUR', 'RUB/CNY'];
  const LABELS = { 'RUB/USD': 'USD / RUB', 'RUB/EUR': 'EUR / RUB', 'RUB/CNY': 'CNY / RUB' };

  function selectOfficialRates(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.observations)) return [];
    const latest = new Map();
    snapshot.observations.forEach(row => {
      if (!row || row.indicator_id !== 'macro.fx_official' ||
          row.validation_status !== 'validated' || !KEYS.includes(row.series_key) ||
          row.unit !== 'RUB_per_1_' + row.series_key.split('/')[1] ||
          !Number.isFinite(Number(row.value)) || Number(row.value) <= 0 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(row.reference_period || '')) ||
          !row.source || row.source.name !== 'Bank of Russia' || !row.source.url) return;
      const previous = latest.get(row.series_key);
      if (!previous || String(row.reference_period) > String(previous.reference_period) ||
          (row.reference_period === previous.reference_period && String(row.retrieved_at) > String(previous.retrieved_at))) {
        latest.set(row.series_key, row);
      }
    });
    return KEYS.filter(key => latest.has(key)).map(key => ({
      key,
      label: LABELS[key],
      value: Number(latest.get(key).value),
      date: latest.get(key).reference_period,
      retrievedAt: latest.get(key).retrieved_at || '',
      sourceName: latest.get(key).source.name,
      sourceUrl: latest.get(key).source.url
    }));
  }

  function freshness(date, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 'unknown';
    const age = (Date.parse((now || new Date()).toISOString().slice(0, 10) + 'T00:00:00Z') -
      Date.parse(date + 'T00:00:00Z')) / 86400000;
    if (!Number.isFinite(age) || age < 0) return 'unknown';
    return age <= 3 ? 'recent' : 'stale';
  }

  function render(container, rows, now) {
    if (!container) return;
    container.replaceChildren();
    if (!rows.length) {
      const note = document.createElement('p');
      note.textContent = 'Нет подтверждённых официальных валютных наблюдений. Расчёт стоимости активов продолжает работать на введённых вами данных.';
      container.append(note);
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'av-market-head';
    const title = document.createElement('strong');
    title.textContent = 'Официальные валютные ориентиры';
    const date = document.createElement('span');
    date.textContent = 'Последнее наблюдение: ' + rows.map(row => row.date).sort().at(-1);
    heading.append(title, date);
    container.append(heading);

    const grid = document.createElement('div');
    grid.className = 'av-market-grid';
    rows.forEach(row => {
      const card = document.createElement('div');
      card.className = 'av-market-rate';
      const label = document.createElement('span');
      label.textContent = row.label;
      const value = document.createElement('strong');
      value.textContent = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(row.value);
      const meta = document.createElement('small');
      meta.textContent = '₽ за 1 ' + row.key.split('/')[1] + ' · ' + row.date;
      card.append(label, value, meta);
      grid.append(card);
    });
    container.append(grid);

    const foot = document.createElement('div');
    foot.className = 'av-market-foot';
    const status = document.createElement('span');
    const state = rows.some(row => freshness(row.date, now) === 'stale') ? 'Данные могут быть устаревшими' : 'Последние подтверждённые наблюдения';
    status.textContent = state + ' · не применяются к оценке автоматически.';
    const source = document.createElement('a');
    source.href = rows[0].sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = rows[0].sourceName + ' — первоисточник';
    foot.append(status, source);
    container.append(foot);
  }

  async function load(container, fetcher) {
    if (!container) return;
    const request = fetcher || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!request) return render(container, [], new Date());
    try {
      const response = await request('/data/analytical-monitoring/observations.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('snapshot unavailable');
      const snapshot = await response.json();
      render(container, selectOfficialRates(snapshot), new Date());
    } catch (_) {
      render(container, [], new Date());
    }
  }

  const api = { selectOfficialRates, freshness, render, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinMarketContext = api;
  if (root && root.document) {
    const start = () => load(root.document.getElementById('av-market-context'));
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
