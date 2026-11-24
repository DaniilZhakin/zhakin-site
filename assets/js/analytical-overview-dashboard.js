(function () {
  'use strict';

  const root = document.getElementById('ac-live-dashboard');
  if (!root) return;

  const snapshotUrl = '/data/analytical-monitoring/observations.json';
  const number = (value, digits) => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
  const dateLabel = value => {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date)
      : value;
  };
  const safeSource = source => source && typeof source.url === 'string' && /^https:\/\//.test(source.url)
    ? source.url : null;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function validatedRows(snapshot) {
    if (!snapshot || snapshot.schema_version !== '1.0.0' ||
        !Array.isArray(snapshot.observations) ||
        snapshot.status !== 'source_fetched_validated') return [];
    return snapshot.observations.filter(row =>
      row && row.validation_status === 'validated' &&
      Number.isFinite(row.value) && row.value >= 0 &&
      typeof row.reference_period === 'string' &&
      row.source && typeof row.source.name === 'string' &&
      safeSource(row.source)
    );
  }

  function latestBy(rows, key) {
    const result = new Map();
    rows.forEach(row => {
      const id = key(row);
      const current = result.get(id);
      if (!current || row.reference_period > current.reference_period ||
          (row.reference_period === current.reference_period &&
           String(row.retrieved_at || '') > String(current.retrieved_at || ''))) {
        result.set(id, row);
      }
    });
    return [...result.values()];
  }

  function renderFx(rows) {
    const host = root.querySelector('[data-fx-cards]');
    const fx = latestBy(rows.filter(row => row.indicator_id === 'macro.fx_official'), row => row.series_key)
      .filter(row => ['RUB/USD', 'RUB/EUR', 'RUB/CNY'].includes(row.series_key));
    host.replaceChildren();
    const labels = { 'RUB/USD': 'Доллар США', 'RUB/EUR': 'Евро', 'RUB/CNY': 'Китайский юань' };
    fx.sort((a, b) => ['RUB/USD', 'RUB/EUR', 'RUB/CNY'].indexOf(a.series_key) -
      ['RUB/USD', 'RUB/EUR', 'RUB/CNY'].indexOf(b.series_key));
    fx.forEach(row => {
      const card = element('article', undefined, 'ac-live-stat');
      card.append(
        element('span', labels[row.series_key] || row.series_key, 'ac-live-label'),
        element('strong', number(row.value, 4), 'ac-live-value'),
        element('small', 'RUB за 1 ' + row.series_key.split('/')[1] + ' · ' + dateLabel(row.reference_period), 'ac-live-meta')
      );
      host.append(card);
    });
    if (!fx.length) host.append(element('p', 'Нет подтверждённых валютных наблюдений в снимке.', 'ac-live-empty'));
  }

  function renderResearch(rows) {
    const host = root.querySelector('[data-rd-chart]');
    const table = root.querySelector('[data-rd-table]');
    const status = root.querySelector('[data-rd-status]');
    const research = rows.filter(row =>
      row.indicator_id === 'tech.rd_gdp' &&
      row.unit === 'percent_GDP' &&
      typeof row.geography === 'string' &&
      typeof row.country_name === 'string'
    );
    const countries = ['USA', 'CHN', 'DEU', 'JPN', 'KOR', 'GBR', 'FRA', 'RUS'];
    const latest = new Map();
    research.forEach(row => {
      const previous = latest.get(row.geography);
      if (!previous || row.reference_period > previous.reference_period) latest.set(row.geography, row);
    });
    const commonYears = research.reduce((years, row) => {
      if (!countries.includes(row.geography)) return years;
      if (!years.has(row.reference_period)) years.set(row.reference_period, new Set());
      years.get(row.reference_period).add(row.geography);
      return years;
    }, new Map());
    const commonYear = [...commonYears.entries()]
      .filter(([, set]) => countries.every(code => set.has(code)))
      .map(([year]) => year)
      .sort()
      .at(-1);

    host.replaceChildren();
    table.replaceChildren();
    if (!commonYear) {
      status.textContent = 'Нет единого подтверждённого года для сопоставления всех восьми стран. Диаграмма не построена.';
      return;
    }
    const rowsForChart = countries.map(code => research.find(row =>
      row.geography === code && row.reference_period === commonYear
    )).filter(Boolean).sort((a, b) => b.value - a.value);
    if (rowsForChart.length !== countries.length) {
      status.textContent = 'Недостаточно подтверждённых значений для сопоставимого графика.';
      return;
    }

    const width = 760, rowHeight = 38, left = 178, right = 66;
    const height = 30 + rowsForChart.length * rowHeight;
    const max = Math.max(...rowsForChart.map(row => row.value)) * 1.12;
    const chart = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img',
      'aria-label': 'Расходы на исследования и разработки в процентах ВВП, ' + commonYear + ' год' });
    rowsForChart.forEach((row, index) => {
      const y = 18 + index * rowHeight;
      const barWidth = Math.max(2, (row.value / max) * (width - left - right));
      chart.append(
        svg('text', { x: left - 12, y: y + 17, 'text-anchor': 'end' }, row.country_name),
        svg('rect', { x: left, y: y + 3, width: barWidth, height: 19, rx: 4, fill: '#b99b43' }),
        svg('text', { x: left + barWidth + 9, y: y + 18 }, number(row.value, 2) + '%')
      );
    });
    host.append(chart);

    const body = element('tbody');
    rowsForChart.forEach(row => {
      const tr = element('tr');
      [row.country_name, number(row.value, 2) + '%', row.reference_period, row.source.name].forEach(value => {
        tr.append(element('td', value));
      });
      body.append(tr);
    });
    table.append(body);
    status.textContent = 'Сопоставимый период: ' + commonYear + ' год. Показатель: расходы на исследования и разработки, % ВВП. Источник: World Bank, World Development Indicators.';
  }

  function render(snapshot) {
    const rows = validatedRows(snapshot);
    if (!rows.length) throw new Error('Снимок не содержит наблюдений, прошедших проверку качества.');
    renderFx(rows);
    renderResearch(rows);
    const generated = snapshot.generated_at ? new Date(snapshot.generated_at) : null;
    root.querySelector('[data-snapshot-date]').textContent = generated && Number.isFinite(generated.getTime())
      ? 'Снимок источников получен: ' + new Intl.DateTimeFormat('ru-RU', {
          dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC'
        }).format(generated) + ' UTC'
      : 'Дата снимка источников не указана.';
    root.querySelector('[data-snapshot-source]').textContent =
      'Используются только записи со статусом validated. Исторические периоды не интерполируются; пропуски не заменяются оценками.';
  }

  fetch(snapshotUrl, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(render)
    .catch(error => {
      root.querySelector('[data-dashboard-status]').textContent =
        'Аналитический снимок временно недоступен. Значения не подставляются автоматически. ' + error.message;
      root.querySelector('[data-dashboard-status]').hidden = false;
    });
})();
