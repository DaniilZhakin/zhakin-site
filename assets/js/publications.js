document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.grid');
  if (!grid || !document.querySelector('body')) return;

  const items = Array.from(grid.querySelectorAll('.item'));
  if (!items.length) return;

  const groups = [
    { id: 'all', label: 'Все' },
    { id: 'finance', label: 'Финансы и инвестиции', match: /Инвестиции|Финансовая система|Капитал|Рынки/i },
    { id: 'ai', label: 'AI и государство', match: /AI|ИИ|Государственное управление|Технологии/i },
    { id: 'law', label: 'Право и институты', match: /Право/i },
    { id: 'infra', label: 'Инфраструктура и экономика', match: /Инфраструктура|Продовольствие/i },
    { id: 'strategy', label: 'Стратегическое развитие', match: /История|Будущее|Экономика/i }
  ];

  const controls = document.createElement('div');
  controls.className = 'publication-filters';
  controls.setAttribute('aria-label', 'Фильтр публикаций по аналитическому направлению');
  controls.innerHTML = groups.map((group, index) => `
    <button type="button" class="publication-filter${index === 0 ? ' is-active' : ''}" data-publication-filter="${group.id}" aria-pressed="${index === 0 ? 'true' : 'false'}">${group.label}</button>
  `).join('');

  const intro = document.querySelector('.intro');
  if (!intro) return;
  intro.insertAdjacentElement('afterend', controls);

  const style = document.createElement('style');
  style.textContent = `
    .publication-filters{display:flex;flex-wrap:wrap;gap:10px;margin-top:34px;padding:14px 0 2px}
    .publication-filter{appearance:none;border:1px solid var(--line);background:rgba(13,30,26,.72);color:var(--muted);padding:10px 14px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:.2s ease}
    .publication-filter:hover,.publication-filter.is-active{color:var(--text);border-color:var(--accent);background:rgba(199,164,90,.08)}
    .item.is-filtered-out{display:none}
    .publication-filter:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    @media(max-width:720px){.publication-filters{gap:8px;margin-top:24px}.publication-filter{font-size:12px;padding:9px 12px}}
  `;
  document.head.appendChild(style);

  const applyFilter = (groupId) => {
    const group = groups.find(item => item.id === groupId) || groups[0];
    items.forEach(item => {
      const meta = item.querySelector('.meta');
      const text = meta ? meta.textContent : '';
      const visible = group.id === 'all' || (group.match && group.match.test(text));
      item.classList.toggle('is-filtered-out', !visible);
    });

    controls.querySelectorAll('.publication-filter').forEach(button => {
      const active = button.dataset.publicationFilter === group.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  controls.addEventListener('click', event => {
    const button = event.target.closest('.publication-filter');
    if (!button) return;
    applyFilter(button.dataset.publicationFilter);
  });
});
