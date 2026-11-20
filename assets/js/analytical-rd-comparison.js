(function () {
  'use strict';
  const body = document.getElementById('rd-comparison-body');
  if (!body) return;
  const count = document.getElementById('rd-comparison-count');
  const status = document.getElementById('rd-comparison-status');
  const periodSelect = document.getElementById('rd-comparison-period');
  const names = { USA: 'США', CHN: 'Китай', DEU: 'Германия', JPN: 'Япония', KOR: 'Республика Корея', GBR: 'Великобритания', FRA: 'Франция', RUS: 'Россия' };
  const order = ['USA', 'CHN', 'DEU', 'JPN', 'KOR', 'GBR', 'FRA', 'RUS'];
  const number = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
  let allRows = [];
  let latestCommonYear = null;
  function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }
  function render() {
    const mode = periodSelect ? periodSelect.value : 'common';
    const latestByCountry = new Map();
    allRows.forEach(row => {
      const previous = latestByCountry.get(row.geography);
      if (!previous || String(row.reference_period) > String(previous.reference_period)) latestByCountry.set(row.geography, row);
    });
    let rows = mode === 'latest'
      ? [...latestByCountry.values()]
      : allRows.filter(row => row.reference_period === latestCommonYear);
    rows = rows.sort((a, b) => Number(b.value) - Number(a.value));
    if (!rows.length) throw new Error('No validated comparison rows for selected period');
    const max = Math.max(...rows.map(row => Number(row.value)));
    body.replaceChildren();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.append(cell(names[row.geography]));
      tr.append(cell(number(Number(row.value)) + '%'));
      tr.append(cell(row.reference_period));
      const barCell = document.createElement('td');
      const track = document.createElement('div');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', number(Number(row.value) / max * 100) + '% от максимума выборки');
      track.style.cssText = 'height:7px;background:#18372b;border-radius:8px;overflow:hidden;min-width:70px';
      const bar = document.createElement('span');
      bar.className = 'mn-rd-bar';
      bar.style.width = Math.max(2, Number(row.value) / max * 100) + '%';
      track.append(bar);
      barCell.append(track);
      tr.append(barCell);
      body.append(tr);
    });
    count.textContent = rows.length + ' из ' + order.length + ' стран';
    status.textContent = mode === 'latest'
      ? 'Последнее доступное наблюдение каждой страны; периоды могут различаться.'
      : 'Единый период ' + latestCommonYear + ' для всех стран выборки.';
    status.textContent += ' Версия источника: ' + (rows[0].source_release_date || 'не указана') + '.';
  }
  fetch('/data/analytical-monitoring/observations.json', { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('snapshot unavailable'); return response.json(); })
    .then(snapshot => {
      allRows = (snapshot.observations || []).filter(row =>
        row.indicator_id === 'tech.rd_gdp' &&
        row.validation_status === 'validated' &&
        Number.isFinite(Number(row.value)) &&
        names[row.geography]
      );
      const yearCoverage = new Map();
      allRows.forEach(row => yearCoverage.set(row.reference_period, (yearCoverage.get(row.reference_period) || new Set()).add(row.geography)));
      const commonYears = [...yearCoverage.entries()]
        .filter(([, countries]) => order.every(code => countries.has(code)))
        .map(([year]) => year).sort();
      latestCommonYear = commonYears.at(-1) || [...yearCoverage.entries()]
        .sort((a, b) => b[1].size - a[1].size || String(b[0]).localeCompare(String(a[0])))[0]?.[0];
      if (!latestCommonYear) throw new Error('no validated country observations');
      if (periodSelect) {
        const commonOption = periodSelect.querySelector('option[value="common"]');
        if (commonOption) commonOption.textContent = commonYears.length ? 'Единый общий год · ' + latestCommonYear : 'Максимальное покрытие · ' + latestCommonYear;
        periodSelect.addEventListener('change', render);
      }
      render();
    })
    .catch(() => {
      body.replaceChildren();
      const tr = document.createElement('tr');
      tr.append(cell('Сравнительная выборка пока не загружена.'));
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'После успешного обновления снимка таблица заполнится официальными данными. Пропуски не заменяются оценками.';
      tr.append(td);
      body.append(tr);
      count.textContent = 'Ожидает данные';
      status.textContent = 'Нет подтверждённых сравнительных наблюдений в опубликованном снимке.';
    });
})();
