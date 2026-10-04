(() => {
  const source = '/data/political-analysis.json';
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const title = document.getElementById('object-title');
  const subtitle = document.getElementById('object-subtitle');
  const notice = document.getElementById('object-notice');
  const content = document.getElementById('object-content');
  const error = document.getElementById('object-error');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const statusText = {active:'активный',inactive:'неактивный',historical:'исторический','under-review':'на проверке',draft:'черновик'};
  const section = (heading, body) => '<article class="object-card"><h2>'+heading+'</h2>'+body+'</article>';
  const list = items => Array.isArray(items) && items.length ? '<ul class="list">'+items.map(item => '<li>'+item+'</li>').join('')+'</ul>' : '<p>Нет опубликованных данных.</p>';

  if (!id) {
    title.textContent = 'Объект не указан';
    error.textContent = 'Откройте карточку из публичного реестра, чтобы передать идентификатор объекта.';
    error.classList.remove('hidden');
    return;
  }

  fetch(source, {cache:'no-store'})
    .then(response => { if (!response.ok) throw new Error('HTTP '+response.status); return response.json(); })
    .then(data => {
      const record = Array.isArray(data.records) ? data.records.find(item => item.id === id) : null;
      if (!record) throw new Error('Объект с идентификатором «'+id+'» не найден в публичном реестре.');
      title.textContent = record.name;
      subtitle.textContent = record.description || 'Структурированный аналитический объект.';
      const status = statusText[record.status] || record.status;
      const due = record.review_due ? new Date(record.review_due+'T00:00:00') : null;
      const today = new Date(); today.setHours(0,0,0,0);
      const days = due ? Math.ceil((due-today)/86400000) : null;
      let review = record.review_due ? 'Следующая проверка: '+esc(record.review_due) : 'Дата следующей проверки не задана.';
      if (days !== null && days < 0) review += ' · срок проверки истёк';
      else if (days !== null && days <= 30) review += ' · проверка в ближайшие 30 дней';
      notice.innerHTML = '<strong>Статус:</strong> '+esc(status)+' · <strong>Юрисдикция:</strong> '+esc(record.jurisdiction || 'не указана')+'<br>'+review;
      notice.classList.remove('hidden');

      const evidence = (record.evidence || []).map(item => '<li><strong>'+esc(item.source_date)+'</strong> — '+esc(item.source)+(item.note ? ': '+esc(item.note) : '')+'</li>');
      const history = (record.change_history || []).map(item => '<li><strong>'+esc(item.date)+'</strong> — '+esc(item.change)+(item.source ? ' · '+esc(item.source) : '')+'</li>');
      const relations = (record.relations || []).map(item => '<li><strong>'+esc(item.type || 'relation')+'</strong> → '+esc(item.target_id)+'</li>');
      content.innerHTML =
        section('Идентичность','<p class="meta"><span class="tag">'+esc(record.object_type)+'</span><span class="tag">'+esc(status)+'</span></p><p><strong>ID:</strong> '+esc(record.id)+'</p><p><strong>Источник:</strong> '+esc(record.source)+'<br><strong>Источник от:</strong> '+esc(record.source_date)+'<br><strong>Последняя проверка:</strong> '+esc(record.last_reviewed)+'</p>')+
        section('Аналитический профиль','<p><strong>Программная позиция:</strong> '+esc(record.program_position || 'не опубликована')+'</p><p><strong>Организационная модель:</strong> '+esc(record.organizational_model || 'не опубликована')+'</p><p><strong>Электоральный профиль:</strong> '+esc(record.electoral_profile || 'не опубликован')+'</p><p><strong>Ресурсы:</strong> '+esc(record.resources || 'не опубликованы')+'</p><p><strong>Коммуникации:</strong> '+esc(record.communications || 'не опубликованы')+'</p>')+
        section('Доказательная база', list(evidence))+
        section('История изменений', list(history))+
        section('Связи объекта', list(relations))+
        section('Сценарная матрица', '<p><strong>Базовый:</strong> '+esc(record.scenario_notes?.base || 'не опубликован')+'</p><p><strong>Альтернативный:</strong> '+esc(record.scenario_notes?.alternative || 'не опубликован')+'</p><p><strong>Стресс:</strong> '+esc(record.scenario_notes?.stress || 'не опубликован')+'</p><p><strong>Ранние индикаторы:</strong> '+esc(record.scenario_notes?.['early-warning-indicators'] || 'не опубликованы')+'</p>');
    })
    .catch(err => { title.textContent = 'Карточка недоступна'; error.textContent = err.message; error.classList.remove('hidden'); });
})();