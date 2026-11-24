(function (root) {
  'use strict';

  const COUNTRIES = {
    USA: 'США',
    CHN: 'Китай',
    DEU: 'Германия',
    JPN: 'Япония',
    KOR: 'Республика Корея',
    GBR: 'Великобритания',
    FRA: 'Франция',
    RUS: 'Россия'
  };
  const SNAPSHOT_URL = '/data/analytical-monitoring/observations.json';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function isWorldBankUrl(value) {\n    try {\n      const url = new URL(value);\n      return url.protocol === 'https:' && url.hostname === 'api.worldbank.org';\n    } catch (_) {\n      return false;\n    }\n  }\n\n  function getSeries(snapshot, country) {
    if (!snapshot || snapshot.schema_version !== '1.0.0' ||
        snapshot.status !== 'source_fetched_validated' ||
        !Array.isArray(snapshot.observations) || !Object.hasOwn(COUNTRIES, country)) return [];

    const byYear = new Map();
    snapshot.observations.forEach(row => {
      if (!row || row.indicator_id !== 'tech.rd_gdp' ||
          row.unit !== 'percent_GDP' ||
          row.validation_status !== 'validated' ||
          row.geography !== country ||
          typeof row.reference_period !== 'string' ||
          !/^\d{4}$/.test(row.reference_period) ||
          !Number.isFinite(row.value) || row.value < 0 ||
          !row.source || row.source.name !== 'World Bank' ||
          !isWorldBankUrl(row.source.url)) return;
      const previous = byYear.get(row.reference_period);
      if (!previous || String(row.retrieved_at || '') > String(previous.retrieved_at || '')) {
        byYear.set(row.reference_period, row);
      }
    });
    return [...byYear.values()].sort((a, b) => Number(a.reference_period) - Number(b.reference_period));
  }

  function chartGeometry(rows, width, height) {
    const w = width || 720;
    const h = height || 280;
    const margin = { top: 24, right: 28, bottom: 42, left: 66 };
    const plotWidth = w - margin.left - margin.right;
    const plotHeight = h - margin.top - margin.bottom;
    const years = rows.map(row => Number(row.reference_period));
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const maxValue = Math.max(...rows.map(row => row.value), 0.1) * 1.12;
    const points = rows.map(row => ({
      year: Number(row.reference_period),
      value: row.value,
      x: margin.left + (maxYear === minYear ? plotWidth / 2 : ((Number(row.reference_period) - minYear) / (maxYear - minYear)) * plotWidth),
      y: margin.top + plotHeight - (row.value / maxValue) * plotHeight
    }));
    const segments = [];
    let segment = [];
    points.forEach((point, index) => {
      if (index && point.year !== points[index - 1].year + 1) {
        if (segment.length) segments.push(segment);
        segment = [];
      }
      segment.push(point);
    });
    if (segment.length) segments.push(segment);
    return {
      width: w, height: h, margin, maxValue, minYear, maxYear,
      points, segments,
      gridValues: [0, maxValue / 2, maxValue]
    };
  }

  const api = { getSeries, chartGeometry, countries: COUNTRIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZhakinRdHistory = api;

  if (typeof document === 'undefined') return;
  const select = document.getElementById('rd-history-country');
  const chart = document.getElementById('rd-history-chart');
  if (!select || !chart) return;
  const table = document.getElementById('rd-history-rows');
  const status = document.getElementById('rd-history-status');
  const range = document.getElementById('rd-history-range');
  const sourceLink = document.getElementById('rd-history-source');
  const format = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
  const svgNode = (tag, attrs, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let snapshot = null;
  function render() {
    const rows = getSeries(snapshot, select.value);
    chart.replaceChildren();
    table.replaceChildren();
    if (!rows.length) {
      chart.append(svgNode('text', { x: 360, y: 135, 'text-anchor': 'middle' }, 'Нет подтверждённых наблюдений'));
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'Для выбранной страны нет подтверждённых значений.';
      tr.append(td);
      table.append(tr);
      status.textContent = 'График не построен: отсутствуют проверенные наблюдения.';
      range.textContent = 'Источник: World Bank · WDI';
      sourceLink.hidden = true;
      return;
    }

    const geometry = chartGeometry(rows);
    chart.setAttribute('viewBox', '0 0 ' + geometry.width + ' ' + geometry.height);
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Динамика расходов на исследования и разработки в процентах ВВП: ' + COUNTRIES[select.value]);
    chart.append(
      svgNode('title', { id: 'rd-history-chart-title' }, 'Динамика расходов на исследования и разработки'),
      svgNode('desc', { id: 'rd-history-chart-desc' }, 'Подтверждённые годовые наблюдения Всемирного банка. Пропущенные годы не интерполируются.')
    );

    geometry.gridValues.forEach(value => {
      const y = geometry.margin.top + (geometry.height - geometry.margin.top - geometry.margin.bottom) * (1 - value / geometry.maxValue);
      chart.append(
        svgNode('line', { x1: geometry.margin.left, y1: y, x2: geometry.width - geometry.margin.right, y2: y, class: 'mn-trend-grid' }),
        svgNode('text', { x: geometry.margin.left - 10, y: y + 4, 'text-anchor': 'end' }, format(value) + '%')
      );
    });

    geometry.segments.forEach(segment => {
      if (segment.length < 2) return;
      const d = segment.map((point, index) => (index ? 'L ' : 'M ') + point.x.toFixed(2) + ' ' + point.y.toFixed(2)).join(' ');
      chart.append(svgNode('path', { d, class: 'mn-trend-line' }));
    });
    geometry.points.forEach(point => {
      chart.append(
        svgNode('circle', { cx: point.x, cy: point.y, r: 4.5, class: 'mn-trend-point' }),
        svgNode('text', { x: point.x, y: geometry.height - 14, 'text-anchor': 'middle' }, String(point.year))
      );
    });

    const body = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      [row.reference_period, format(row.value) + '%'].forEach(value => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);

    const firstYear = rows[0].reference_period;
    const lastYear = rows[rows.length - 1].reference_period;
    const gaps = geometry.points.slice(1).filter((point, index) => point.year !== geometry.points[index].year + 1).length;
    status.textContent = rows.length + ' подтверждённых годовых наблюдений. ' +
      (gaps ? 'Пропущенные годы показаны разрывами; интерполяция не применяется.' : 'Все доступные годовые точки показаны без интерполяции.');
    range.textContent = 'Период наблюдений: ' + firstYear + '–' + lastYear + ' · ' + rows[0].source.name +
      ' · версия источника: ' + (rows[0].source_release_date || 'не указана');
    sourceLink.href = rows[0].source.url;
    sourceLink.hidden = false;
  }

  fetch(SNAPSHOT_URL, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(data => {
      snapshot = data;
      const available = Object.keys(COUNTRIES).filter(code => getSeries(snapshot, code).length);
      select.replaceChildren();
      available.forEach(code => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = COUNTRIES[code];
        select.append(option);
      });
      if (!available.length) throw new Error('no validated R&D observations');
      select.value = available.includes('USA') ? 'USA' : available[0];
      select.addEventListener('change', render);
      render();
    })
    .catch(() => {
      chart.replaceChildren(svgNode('text', { x: 360, y: 135, 'text-anchor': 'middle' }, 'Данные временно недоступны'));
      status.textContent = 'Подтверждённый снимок не загружен. Значения не подставляются автоматически.';
      range.textContent = 'Источник: World Bank · WDI';
      sourceLink.hidden = true;
    });
})(typeof window !== 'undefined' ? window : globalThis);
