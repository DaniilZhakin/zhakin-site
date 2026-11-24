(function () {
  'use strict';

  const root = document.querySelector('[data-coverage-dashboard]');
  if (!root) return;
  const snapshotUrl = '/data/analytical-monitoring/observations.json';
  const number = value => new Intl.NumberFormat('ru-RU').format(value);
  const dateTime = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC'
      : 'Дата не указана';
  };
  const node = (tag, value, className) => {
    const item = document.createElement(tag);
    if (value !== undefined) item.textContent = value;
    if (className) item.className = className;
    return item;
  };

  function validatedRows(snapshot) {
    if (!snapshot || snapshot.schema_version !== '1.0.0' ||
        snapshot.status !== 'source_fetched_validated' ||
        !Array.isArray(snapshot.observations)) return [];
    return snapshot.observations.filter(row =>
      row && row.validation_status === 'validated' &&
      Number.isFinite(row.value) && row.value >= 0 &&
      typeof row.indicator_id === 'string' &&
      typeof row.reference_period === 'string' &&
      row.source && typeof row.source.name === 'string' &&
      typeof row.source.url === 'string' && /^https:\/\//.test(row.source.url)
    );
  }

  function summarize(rows) {
    const sources = new Set(rows.map(row => row.source.name));
    const geographies = new Set(rows.map(row => row.geography).filter(Boolean));
    const retrieved = rows.map(row => row.retrieved_at).filter(value => Number.isFinite(Date.parse(value))).sort();
    const groups = new Map();
    rows.forEach(row => {
      const key = row.indicator_id + '|' + row.unit;
      if (!groups.has(key)) groups.set(key, {
        id: row.indicator_id, unit: row.unit, count: 0,
        geographies: new Set(), periods: [], sources: new Set()
      });
      const group = groups.get(key);
      group.count += 1;
      if (row.geography) group.geographies.add(row.geography);
      group.periods.push(row.reference_period);
      group.sources.add(row.source.name);
    });
    return {
      sources: [...sources].sort(),
      geographies: [...geographies].sort(),
      latestRetrieved: retrieved.at(-1) || null,
      groups: [...groups.values()].map(group => ({
        ...group,
        geographies: [...group.geographies].sort(),
        sources: [...group.sources].sort(),
        firstPeriod: group.periods.slice().sort()[0],
        lastPeriod: group.periods.slice().sort().at(-1)
      })).sort((a, b) => a.id.localeCompare(b.id))
    };
  }

  function render(snapshot) {
    const rows = validatedRows(snapshot);
    if (!rows.length) throw new Error('В снимке нет записей, прошедших проверку качества.');
    const summary = summarize(rows);
    const cards = root.querySelector('[data-coverage-kpis]');
    cards.replaceChildren();
    [
      ['Подтверждённые наблюдения', number(rows.length)],
      ['Первоисточники', number(summary.sources.length)],
      ['Географии', number(summary.geographies.length)],
      ['Последняя загрузка', dateTime(summary.latestRetrieved)]
    ].forEach(([label, value]) => {
      const card = node('article', undefined, 'mn-observation');
      card.append(node('span', label, 'mn-observation-label'), node('strong', value, 'mn-observation-value'));
      cards.append(card);
    });

    const body = root.querySelector('[data-coverage-rows]');
    body.replaceChildren();
    summary.groups.forEach(group => {
      const row = node('tr');
      [
        group.id,
        number(group.count),
        number(group.geographies.length),
        group.firstPeriod + ' — ' + group.lastPeriod,
        group.sources.join(', ')
      ].forEach(value => row.append(node('td', value)));
      body.append(row);
    });

    const geographyBody = root.querySelector('[data-coverage-geographies]');
    geographyBody.replaceChildren();
    const rd = rows.filter(row => row.indicator_id === 'tech.rd_gdp');
    const countryMap = new Map();
    rd.forEach(row => {
      if (!countryMap.has(row.geography)) countryMap.set(row.geography, { name: row.country_name || row.geography, count: 0, years: [] });
      const item = countryMap.get(row.geography);
      item.count += 1;
      item.years.push(row.reference_period);
    });
    [...countryMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru')).forEach(([code, item]) => {
      const years = item.years.slice().sort();
      const row = node('tr');
      [item.name, code, number(item.count), years[0] + ' — ' + years.at(-1)].forEach(value => row.append(node('td', value)));
      geographyBody.append(row);
    });
    if (!countryMap.size) {
      const row = node('tr');
      const cell = node('td', 'Нет подтверждённых страновых наблюдений для выбранного индикатора.');
      cell.colSpan = 4;
      row.append(cell);
      geographyBody.append(row);
    }

    root.querySelector('[data-coverage-status]').textContent =
      'Снимок сформирован: ' + dateTime(snapshot.generated_at) +
      '. В расчёт включены только записи со статусом validated и HTTPS-источником. ' +
      'Количество наблюдений не означает полноту всей статистики по стране или рынку.';
    root.querySelector('[data-coverage-sources]').textContent =
      'Источники в снимке: ' + summary.sources.join(' · ') + '.';
  }

  fetch(snapshotUrl, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(render)
    .catch(error => {
      root.querySelector('[data-coverage-status]').textContent =
        'Панель покрытия временно недоступна. Значения не подставляются автоматически. ' + error.message;
    });
})();