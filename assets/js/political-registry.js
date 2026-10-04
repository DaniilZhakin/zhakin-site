(() => {
  const source = '/data/political-analysis.json';
  const search = document.getElementById('registry-search');
  const type = document.getElementById('registry-type');
  const status = document.getElementById('registry-status');
  const jurisdiction = document.getElementById('registry-jurisdiction');
  const grid = document.getElementById('registry-grid');
  const count = document.getElementById('registry-count');
  const empty = document.getElementById('registry-empty');
  const error = document.getElementById('registry-error');
  let records = [];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const optionize = (select, values) => values.sort().forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const t = type.value;
    const s = status.value;
    const j = jurisdiction.value.trim().toLowerCase();
    const filtered = records.filter(record => {
      const haystack = [record.name, record.description, record.id].filter(Boolean).join(' ').toLowerCase();
      return (!q || haystack.includes(q))
        && (!t || record.object_type === t)
        && (!s || record.status === s)
        && (!j || String(record.jurisdiction || '').toLowerCase().includes(j));
    });
    count.textContent = 'Объектов: ' + filtered.length + ' из ' + records.length;
    grid.innerHTML = filtered.map(record => {
      const evidenceCount = Array.isArray(record.evidence) ? record.evidence.length : 0;
      const historyCount = Array.isArray(record.change_history) ? record.change_history.length : 0;
      return '<article class="registry-card">' +
        '<h3>' + esc(record.name) + '</h3>' +
        '<div class="meta"><span class="tag">' + esc(record.object_type) + '</span><span class="tag">' + esc(record.status) + '</span>' +
        (record.jurisdiction ? '<span class="tag">' + esc(record.jurisdiction) + '</span>' : '') + '</div>' +
        (record.description ? '<p>' + esc(record.description) + '</p>' : '') +
        '<p class="source"><strong>Источник:</strong> ' + esc(record.source) + '<br><strong>Источник от:</strong> ' + esc(record.source_date) +
        '<br><strong>Проверено:</strong> ' + esc(record.last_reviewed) +
        (record.review_due ? '<br><strong>Следующая проверка:</strong> ' + esc(record.review_due) : '') +
        '<br><strong>Доказательств:</strong> ' + evidenceCount + ' · <strong>Изменений:</strong> ' + historyCount + '</p>' +
        '</article>';
    }).join('');
    empty.classList.toggle('hidden', records.length !== 0);
    if (records.length !== 0 && filtered.length === 0) {
      grid.innerHTML = '<div class="empty">По заданным фильтрам объектов не найдено.</div>';
    }
  };

  [search, type, status, jurisdiction].forEach(control => control.addEventListener('input', render));

  fetch(source, { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
    .then(data => {
      records = Array.isArray(data.records) ? data.records : [];
      optionize(type, [...new Set(records.map(r => r.object_type).filter(Boolean))]);
      optionize(status, [...new Set(records.map(r => r.status).filter(Boolean))]);
      render();
    })
    .catch(err => {
      count.textContent = 'Реестр недоступен';
      error.textContent = 'Не удалось загрузить структурированный реестр: ' + err.message;
      error.classList.remove('hidden');
    });
})();