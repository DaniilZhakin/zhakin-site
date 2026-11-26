(function (root) {
  'use strict';
  const sharedHistory = root.ZhakinAssetHistory || (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./asset-history-unification.js') : null);
  const STORAGE_KEY = 'zhakin_analytical_asset_history_v1';
  const MAX_RECORDS = 200;
  const TYPES = ['business', 'property', 'equipment', 'other'];
  const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];
  const LABELS = { business: 'Бизнес', property: 'Недвижимость', equipment: 'Оборудование', other: 'Другой актив' };

  function validDate(value) {
    if (typeof value !== 'string' || value.length !== 10) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function assetIdentity(row) { return row.type + ':' + row.name.toLocaleLowerCase('ru-RU'); }
  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  }
  function createRecord(input, now) {
    const name = normalizeName(input && input.name);
    const type = String(input && input.type || '');
    const currency = String(input && input.currency || '');
    const date = String(input && input.date || '');
    const value = Number(input && input.value);
    if (!name) throw new Error('Укажите краткое название актива.');
    if (!TYPES.includes(type)) throw new Error('Выберите корректный тип актива.');
    if (!CURRENCIES.includes(currency)) throw new Error('Выберите поддерживаемую валюту.');
    if (!validDate(date)) throw new Error('Укажите корректную дату оценки.');
    if (!Number.isFinite(value) || value <= 0 || value > 1e15) throw new Error('Стоимость должна быть больше нуля и не превышать допустимый диапазон.');
    const createdAt = new Date(now === undefined ? Date.now() : now).toISOString();
    return {
      id: 'valuation-' + createdAt.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 8),
      name,
      type,
      date,
      value,
      currency,
      method: String(input && input.method || '').trim().slice(0, 120),
      createdAt
    };
  }
  function validateRecords(value) {
    if (!Array.isArray(value) || value.length > MAX_RECORDS) return [];
    const ids = new Set();
    return value.filter(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id) ||
          normalizeName(row.name) !== row.name || !TYPES.includes(row.type) ||
          !CURRENCIES.includes(row.currency) || !validDate(row.date) ||
          !Number.isFinite(Number(row.value)) || Number(row.value) <= 0 || Number(row.value) > 1e15 ||
          typeof row.method !== 'string' || row.method.length > 120 ||
          typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) return false;
      ids.add(row.id);
      return true;
    }).map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      date: row.date,
      value: Number(row.value),
      currency: row.currency,
      method: row.method,
      createdAt: row.createdAt
    }));
  }
  function readRecords(storage) {
    if (sharedHistory) return sharedHistory.read(storage).map(row => ({ id: row.id, name: row.name, type: row.kind, date: row.assessmentDate, value: row.value, currency: row.currency, method: row.method.slice(0, 120), createdAt: row.createdAt }));
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch (_) { throw new Error('Локальное хранилище недоступно.'); }
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { parsed = []; }
    const valid = validateRecords(parsed);
    if (!Array.isArray(parsed) || JSON.stringify(parsed) !== JSON.stringify(valid)) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(valid)); }
      catch (_) { throw new Error('Не удалось обновить локальную историю.'); }
    }
    return valid;
  }
  function writeRecords(storage, rows) {
    if (sharedHistory) return sharedHistory.write(storage, rows).map(row => ({ id: row.id, name: row.name, type: row.kind, date: row.assessmentDate, value: row.value, currency: row.currency, method: row.method.slice(0, 120), createdAt: row.createdAt }));
    const source = Array.isArray(rows) ? rows.slice(-MAX_RECORDS) : rows;
    const valid = validateRecords(source);
    storage.setItem(STORAGE_KEY, JSON.stringify(valid));
    return valid;
  }
  function groupLatest(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = assetIdentity(row);
      const previous = groups.get(key);
      if (!previous || row.date > previous.date || (row.date === previous.date && row.createdAt > previous.createdAt)) {
        groups.set(key, row);
      }
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  function formatValue(value, currency) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  }

  function init(document, storage) {
    const form = document.getElementById('asset-history-form');
    const list = document.getElementById('asset-history-list');
    const compare = document.getElementById('asset-compare-list');
    const chart = document.getElementById('asset-history-chart');
    const trendChart = document.getElementById('asset-trend-chart');
    const trendSelect = document.getElementById('asset-trend-select');
    const status = document.getElementById('asset-dashboard-status');
    const count = document.getElementById('asset-history-count');
    const clear = document.getElementById('clear-asset-history');
    const historySection = list && list.closest('.ad-section');
    const summary = document.createElement('div');
    summary.className = 'ad-kpi-grid';
    summary.setAttribute('aria-label', 'Сводные показатели истории оценок');
    const filterBar = document.createElement('div');
    filterBar.className = 'ad-filter-bar';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Поиск по названию актива';
    searchInput.setAttribute('aria-label', 'Поиск по названию актива');
    const typeFilter = document.createElement('select');
    typeFilter.setAttribute('aria-label', 'Фильтр по типу актива');
    [['all', 'Все типы'], ...TYPES.map(type => [type, LABELS[type]])].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; typeFilter.append(option);
    });
    const currencyFilter = document.createElement('select');
    currencyFilter.setAttribute('aria-label', 'Фильтр по валюте');
    [['all', 'Все валюты'], ...CURRENCIES.map(currency => [currency, currency])].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; currencyFilter.append(option);
    });
    const periodFilter = document.createElement('select');
    periodFilter.setAttribute('aria-label', 'Фильтр по периоду');
    [['all', 'За всё время'], ['30', '30 дней'], ['90', '90 дней'], ['365', '12 месяцев']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; periodFilter.append(option);
    });
    [searchInput, typeFilter, currencyFilter, periodFilter].forEach(control => filterBar.append(control));
    const style = document.createElement('style');
    style.textContent = '.ad-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 18px}.ad-kpi{min-width:0;padding:14px;border:1px solid rgba(212,175,55,.2);border-radius:10px;background:linear-gradient(145deg,rgba(212,175,55,.08),rgba(7,26,22,.8))}.ad-kpi span{display:block;color:#91a398;font-size:.65rem;letter-spacing:.05em;text-transform:uppercase}.ad-kpi strong{display:block;margin-top:7px;color:#ead9aa;font-size:clamp(1rem,2vw,1.45rem);overflow-wrap:anywhere}.ad-filter-bar{display:grid;grid-template-columns:minmax(180px,1.5fr) repeat(3,minmax(110px,1fr));gap:9px;margin:0 0 14px}.ad-filter-bar input,.ad-filter-bar select{width:100%;min-width:0;min-height:42px;padding:9px 10px;border:1px solid rgba(212,175,55,.22);border-radius:8px;background:#071a16;color:#e4eee7;font:inherit;font-size:.74rem}.ad-filter-result{margin:0 0 12px;color:#91a398;font-size:.68rem}@media(max-width:700px){.ad-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ad-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))}.ad-filter-bar input{grid-column:1/-1}}@media(max-width:380px){.ad-kpi{padding:11px}.ad-filter-bar{gap:7px}}';
    if (historySection && !historySection.querySelector('.ad-kpi-grid')) {
      document.head.append(style);
      historySection.insertBefore(summary, list);
      historySection.insertBefore(filterBar, list);
    }
    const filterResult = document.createElement('p');
    filterResult.className = 'ad-filter-result';
    filterResult.setAttribute('aria-live', 'polite');
    if (historySection) historySection.insertBefore(filterResult, list);
    if (!form || !list || !compare || !chart || !trendChart || !trendSelect) return;
    let rows = readRecords(storage);
    let selectedAssetIds = new Set();
    let comparisonInitialized = false;
    const el = (tag, text, cls) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (cls) node.className = cls;
      return node;
    };
    const svg = (tag, attrs, text) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
      if (text !== undefined) node.textContent = text;
      return node;
    };
    function render() {
      list.replaceChildren();
      const previouslySelected = new Set([...compare.querySelectorAll('input:checked')].map(input => input.value));
      if (comparisonInitialized) selectedAssetIds = previouslySelected;
      compare.replaceChildren();
      const latest = groupLatest(rows);
      const dates = rows.map(row => row.date).sort();
      const currencies = [...new Set(rows.map(row => row.currency))];
      const kpis = [
        ['Оценки', String(rows.length)],
        ['Активы', String(latest.length)],
        ['Последняя оценка', dates.length ? dates[dates.length - 1] : '—'],
        ['Валюты', currencies.length ? currencies.join(' · ') : '—']
      ];
      summary.replaceChildren();
      kpis.forEach(([label, value]) => {
        const card = el('div', undefined, 'ad-kpi');
        card.append(el('span', label), el('strong', value));
        summary.append(card);
      });
      count.textContent = rows.length + ' записей · ' + latest.length + ' активов';
      const cutoff = periodFilter.value === 'all' ? null : Date.now() - Number(periodFilter.value) * 86400000;
      const visible = rows.filter(row =>
        (!searchInput.value.trim() || row.name.toLocaleLowerCase('ru-RU').includes(searchInput.value.trim().toLocaleLowerCase('ru-RU'))) &&
        (typeFilter.value === 'all' || row.type === typeFilter.value) &&
        (currencyFilter.value === 'all' || row.currency === currencyFilter.value) &&
        (cutoff === null || Date.parse(row.date + 'T23:59:59Z') >= cutoff)
      );
      filterResult.textContent = 'Показано ' + visible.length + ' из ' + rows.length + ' записей. Фильтры влияют только на список; графики используют всю историю.';
      if (!rows.length) list.append(el('p', 'История пока пуста. Добавьте первую оценку — запись останется в этом браузере.', 'ad-empty'));
      else if (!visible.length) list.append(el('p', 'По заданным фильтрам записей не найдено. Измените условия поиска.', 'ad-empty'));
      [...visible].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).forEach(row => {
        const item = el('article', undefined, 'ad-history-item');
        const info = el('div');
        info.append(el('strong', row.name), el('span', LABELS[row.type] + ' · ' + row.date + (row.method ? ' · ' + row.method : '')));
        item.append(info, el('b', formatValue(row.value, row.currency)));
        const remove = el('button', 'Удалить', 'ad-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Удалить запись: ' + row.name + ', ' + row.date);
        remove.addEventListener('click', () => {
          if (typeof root.confirm !== 'function' || !root.confirm('Удалить эту запись из локальной истории?')) return;
          try {
            rows = writeRecords(storage, rows.filter(itemRow => itemRow.id !== row.id));
          } catch (_) {
            status.textContent = 'Не удалось удалить запись: браузер не разрешил обновить локальную историю.';
            return;
          }
          render();
          status.textContent = 'Запись удалена из локальной истории.';
        });
        item.append(remove);
        list.append(item);
      });
      const previousTrend = trendSelect.value;
      trendSelect.replaceChildren();
      latest.forEach(row => {
        const option = el('option', row.name);
        option.value = assetIdentity(row);
        trendSelect.append(option);
      });
      if ([...trendSelect.options].some(option => option.value === previousTrend)) trendSelect.value = previousTrend;
      latest.forEach((row, index) => {
        const label = el('label', undefined, 'ad-compare-option');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.value = row.id;
        checkbox.checked = comparisonInitialized ? selectedAssetIds.has(row.id) : index < 3;
        checkbox.addEventListener('change', () => {
          const checked = [...compare.querySelectorAll('input:checked')];
          if (checked.length > 4) {
            checkbox.checked = false;
            status.textContent = 'Для сравнения можно выбрать не более четырёх активов.';
          }
          selectedAssetIds = new Set([...compare.querySelectorAll('input:checked')].map(input => input.value));
          comparisonInitialized = true;
          renderChart();
        });
        label.append(checkbox, el('span', row.name + ' · ' + formatValue(row.value, row.currency)));
        compare.append(label);
      });
      selectedAssetIds = new Set([...compare.querySelectorAll('input:checked')].map(input => input.value));
      comparisonInitialized = true;
      renderChart();
      renderTrend();
    }
    function renderChart() {
      const selectedIds = [...compare.querySelectorAll('input:checked')].map(input => input.value);
      const latest = groupLatest(rows).filter(row => selectedIds.includes(row.id)).slice(0, 4);
      chart.replaceChildren();
      if (!latest.length) {
        chart.append(svg('text', { x: 360, y: 125, 'text-anchor': 'middle' }, 'Выберите активы для сравнения'));
        return;
      }
      if (new Set(latest.map(row => row.currency)).size > 1) {
        chart.append(svg('text', { x: 360, y: 125, 'text-anchor': 'middle' }, 'Для сравнения выберите одну валюту'));
        return;
      }
      const values = latest.map(row => row.value);
      const max = Math.max(...values);
      const left = 24, top = 22, barHeight = 30, gap = 18, width = 660;
      latest.forEach((row, index) => {
        const y = top + index * (barHeight + gap);
        chart.append(svg('text', { x: left, y: y + 12, class: 'ad-chart-label' }, row.name.slice(0, 28)));
        chart.append(svg('rect', { x: left, y: y + 18, width, height: 9, rx: 4, class: 'ad-chart-track' }));
        const bar = svg('rect', { x: left, y: y + 18, width: Math.max(3, width * row.value / max), height: 9, rx: 4, class: 'ad-chart-bar' });
        bar.append(svg('title', {}, row.name + ': ' + formatValue(row.value, row.currency)));
        chart.append(bar);
        chart.append(svg('text', { x: left + width, y: y + 12, 'text-anchor': 'end', class: 'ad-chart-value' }, formatValue(row.value, row.currency)));
      });
    }
    function renderTrend() {
      const key = trendSelect.value;
      trendChart.replaceChildren();
      if (!key) {
        trendChart.append(svg('text', { x: 360, y: 125, 'text-anchor': 'middle' }, 'Добавьте оценки для динамики'));
        return;
      }
      const pointsByDate = new Map();
      rows.filter(row => assetIdentity(row) === key).forEach(row => {
        const previous = pointsByDate.get(row.date);
        if (!previous || row.createdAt > previous.createdAt) pointsByDate.set(row.date, row);
      });
      const points = [...pointsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (points.length < 2) {
        trendChart.append(svg('text', { x: 360, y: 125, 'text-anchor': 'middle' }, 'Для динамики нужны минимум две даты оценки'));
        return;
      }
      if (new Set(points.map(row => row.currency)).size > 1) {
        trendChart.append(svg('text', { x: 360, y: 125, 'text-anchor': 'middle' }, 'В истории актива изменилась валюта'));
        return;
      }
      const values = points.map(row => row.value);
      const min = Math.min(...values), max = Math.max(...values);
      const spread = max - min || Math.max(Math.abs(max) * .02, 1);
      const low = min - spread * .15, high = max + spread * .15;
      const x0 = 54, x1 = 690, y0 = 22, y1 = 190;
      const firstDate = Date.parse(points[0].date + 'T00:00:00Z');
      const lastDate = Date.parse(points[points.length - 1].date + 'T00:00:00Z');
      const x = date => x0 + (x1 - x0) * (Date.parse(date + 'T00:00:00Z') - firstDate) / (lastDate - firstDate);
      const y = value => y1 - (value - low) / (high - low) * (y1 - y0);
      trendChart.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const ratio = i / 3;
        const yy = y0 + (y1 - y0) * ratio;
        const tickValue = high - (high - low) * ratio;
        trendChart.append(svg('line', { x1: x0, y1: yy, x2: x1, y2: yy, class: 'ad-chart-track', stroke: 'rgba(212,175,55,.2)' }));
        trendChart.append(svg('text', { x: x0 - 8, y: yy + 4, 'text-anchor': 'end', class: 'ad-chart-value' }, formatValue(tickValue, points[0].currency)));
      }
      trendChart.append(svg('polyline', { points: points.map(point => x(point.date) + ',' + y(point.value)).join(' '), fill: 'none', stroke: '#d4af37', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      points.forEach((point, index) => {
        const marker = svg('circle', { cx: x(point.date), cy: y(point.value), r: 5, fill: '#ead9aa' });
        marker.append(svg('title', {}, point.date + ' · ' + formatValue(point.value, point.currency)));
        trendChart.append(marker);
        if (index === 0 || index === points.length - 1 || points.length <= 6) {
          trendChart.append(svg('text', { x: x(point.date), y: 222, 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', class: 'ad-chart-label' }, point.date));
        }
      });
    }
    [searchInput, typeFilter, currencyFilter, periodFilter].forEach(control => control.addEventListener('input', render));
    [typeFilter, currencyFilter, periodFilter].forEach(control => control.addEventListener('change', render));
    trendSelect.addEventListener('change', renderTrend);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const record = createRecord({
          name: data.get('name'), type: data.get('type'), date: data.get('date'),
          value: data.get('value'), currency: data.get('currency'), method: data.get('method')
        });
        rows = writeRecords(storage, [...rows, record]);
        render();
        form.reset();
        const dateInput = form.querySelector('[name="date"]');
        if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
        status.textContent = 'Оценка сохранена локально. Данные не отправлялись на сервер.';
      } catch (error) { status.textContent = error.message; }
    });
    clear.addEventListener('click', () => {
      if (!rows.length || !root.confirm('Удалить всю историю оценок из этого браузера?')) return;
      try { if (sharedHistory) sharedHistory.clear(storage); else storage.removeItem(STORAGE_KEY); }
      catch (_) {
        status.textContent = 'Не удалось очистить историю: браузер не разрешил удалить локальные данные.';
        return;
      }
      rows = [];
      render();
      status.textContent = 'Локальная история очищена.';
    });
    const dateInput = form.querySelector('[name="date"]');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    render();
  }

  const api = { STORAGE_KEY, MAX_RECORDS, TYPES, CURRENCIES, createRecord, validateRecords, readRecords, writeRecords, groupLatest, formatValue, init, assetIdentity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinAssetDashboard = api;
  if (root && root.document) {
    const start = () => {
      try { init(root.document, root.localStorage); }
      catch (_) {
        const status = root.document.getElementById('asset-dashboard-status');
        if (status) status.textContent = 'Локальное хранилище недоступно в этом браузере. История не была сохранена.';
      }
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
