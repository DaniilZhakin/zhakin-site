(function () {
  'use strict';
  const body = document.getElementById('rd-comparison-body');
  if (!body) return;
  const count = document.getElementById('rd-comparison-count');
  const status = document.getElementById('rd-comparison-status');
  const names = { USA: 'США', CHN: 'Китай', DEU: 'Германия', JPN: 'Япония', KOR: 'Республика Корея', GBR: 'Великобритания', FRA: 'Франция', RUS: 'Россия' };
  const order = ['USA', 'CHN', 'DEU', 'JPN', 'KOR', 'GBR', 'FRA', 'RUS'];
  const number = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
  function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }
  fetch('/data/analytical-monitoring/observations.json', { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('snapshot unavailable'); return response.json(); })
    .then(snapshot => {
      const latest = new Map();
      (snapshot.observations || []).filter(row => row.indicator_id === 'tech.rd_gdp' && row.validation_status === 'validated' && Number.isFinite(Number(row.value)))
        .forEach(row => {
          const code = row.geography;
          if (!names[code]) return;
          const previous = latest.get(code);
          if (!previous || String(row.reference_period) > String(previous.reference_period)) latest.set(code, row);
        });
      const rows = order.map(code => latest.get(code)).filter(Boolean).sort((a, b) => Number(b.value) - Number(a.value));
      if (!rows.length) throw new Error('no validated country observations');
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
      status.textContent = 'Последнее доступное наблюдение каждой страны; значения и годы указаны отдельно. Срез источника: ' + (rows[0].source_release_date || 'дата не указана') + '.';
      if (rows.length < order.length) status.textContent += ' Для части стран источник пока не вернул валидное значение.';
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
