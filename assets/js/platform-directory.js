document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('#platform-grid');
  const search = document.querySelector('#platform-search');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const cards = [...(grid?.querySelectorAll('.platform-card') || [])];
  const empty = document.querySelector('#platform-empty');
  const count = document.querySelector('#platform-count');
  if (!grid || !search || !count) return;
  let activeFilter = 'all';
  const update = () => {
    const query = search.value.trim().toLocaleLowerCase('ru');
    let visible = 0;
    cards.forEach(card => {
      const matchesFilter = activeFilter === 'all' || card.dataset.kind === activeFilter;
      const haystack = (card.textContent + ' ' + (card.dataset.search || '')).toLocaleLowerCase('ru');
      const matchesSearch = !query || haystack.includes(query);
      const show = matchesFilter && matchesSearch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (empty) empty.hidden = visible !== 0;
    count.textContent = 'Показано ' + visible + ' из ' + cards.length + ' разделов';
  };
  search.addEventListener('input', update);
  filters.forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter || 'all';
    filters.forEach(item => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    update();
  }));
  update();
});
