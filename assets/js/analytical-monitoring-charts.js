(function () {
  'use strict';
  const historyUrl = '/data/analytical-monitoring/history.json';
  const chart = document.getElementById('fx-history-chart');
  if (!chart) return;
  const title = document.getElementById('fx-chart-title');
  const status = document.getElementById('fx-chart-status');
  const range = document.getElementById('fx-chart-range');
  const labels = { 'RUB/USD': 'USD / RUB', 'RUB/EUR': 'EUR / RUB', 'RUB/CNY': 'CNY / RUB' };
  let rows = [];
  let active = 'RUB/USD';

  function node(name, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function message(text) {
    chart.replaceChildren(node('text', { x: 360, y: 125, 'text-anchor': 'middle' }, text));
  }
  function render() {
    const grouped = new Map();
    rows.filter(row => row.series_key === active && row.validation_status === 'validated' && Number.isFinite(Number(row.value)))
      .forEach(row => {
        const old = grouped.get(row.reference_period);
        if (!old || String(row.retrieved_at) > String(old.retrieved_at)) grouped.set(row.reference_period, row);
      });
    const points = [...grouped.values()].sort((a, b) => String(a.reference_period).localeCompare(String(b.reference_period)));
    title.textContent = labels[active];
    if (points.length < 2) {
      message('История формируется · пока одна дата');
      status.textContent = 'Недостаточно точек для построения динамики. Линия появится после следующего подтверждённого периода.';
      range.textContent = points.length ? 'Доступно наблюдение: ' + points[0].reference_period : 'Нет подтверждённых наблюдений';
      return;
    }
    const values = points.map(row => Number(row.value));
    const min = Math.min(...values), max = Math.max(...values);
    const spread = max - min || Math.max(Math.abs(max) * 0.02, 0.01);
    const low = min - spread * 0.16, high = max + spread * 0.16;
    const x0 = 66, x1 = 690, y0 = 24, y1 = 204;
    const x = index => x0 + (x1 - x0) * index / (points.length - 1);
    const y = value => y1 - (value - low) / (high - low) * (y1 - y0);
    chart.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const yy = y0 + (y1 - y0) * i / 3;
      chart.append(node('line', { x1: x0, y1: yy, x2: x1, y2: yy, class: 'chart-grid' }));
      chart.append(node('text', { x: 8, y: yy + 4 }, (high - (high - low) * i / 3).toFixed(2)));
    }
    chart.append(node('polyline', { points: points.map((p, i) => x(i) + ',' + y(Number(p.value))).join(' '), class: 'chart-line' }));
    points.forEach((point, i) => {
      chart.append(node('circle', { cx: x(i), cy: y(Number(point.value)), r: 5, class: 'chart-point' }));
      if (i === 0 || i === points.length - 1 || points.length <= 6) {
        chart.append(node('text', { x: x(i), y: 232, 'text-anchor': i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle') }, point.reference_period));
      }
    });
    status.textContent = points.length + ' подтверждённых дат · официальные значения';
    range.textContent = points[0].reference_period + ' — ' + points[points.length - 1].reference_period;
  }
  document.querySelectorAll('[data-series]').forEach(button => {
    button.addEventListener('click', () => {
      active = button.dataset.series;
      document.querySelectorAll('[data-series]').forEach(item => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
  });
  fetch(historyUrl, { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('history unavailable'); return response.json(); })
    .then(data => { rows = Array.isArray(data.observations) ? data.observations : []; render(); })
    .catch(() => {
      message('История пока недоступна');
      status.textContent = 'Не удалось загрузить архив наблюдений. Текущие карточки остаются доступны выше.';
      range.textContent = 'Архив источников';
    });
})();
