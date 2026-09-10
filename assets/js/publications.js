document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.grid');
  if (!grid || !document.querySelector('body')) return;

  const items = Array.from(grid.querySelectorAll('.item'));
  if (!items.length) return;

  const groups = [
    { id: 'all', label: 'Все' },
    { id: 'finance', label: 'Финансы и инвестиции' },
    { id: 'ai', label: 'AI и государство' },
    { id: 'law', label: 'Право и институты' },
    { id: 'infra', label: 'Инфраструктура и экономика' },
    { id: 'strategy', label: 'Стратегическое развитие' }
  ];

  const classification = {
    '/publications/money-financial-system.html': 'finance',
    '/publications/digital-ruble.html': 'finance',
    '/publications/ai-financial-system.html': 'finance',
    '/publications/price-discovery.html': 'finance',
    '/publications/ai-parliament.html': 'ai',
    '/publications/ai-infrastructure.html': 'ai',
    '/publications/understanding-state-and-law.html': 'law',
    '/publications/legal-architecture.html': 'law',
    '/publications/food-infrastructure.html': 'infra',
    '/publications/economic-transition-1990s.html': 'strategy',
    '/publications/future-without-money.html': 'strategy',
    '/publications/intellectual-economy.html': 'strategy',
    '/publications/capital-requires-proof.html': 'strategy'
  };

  const getGroupId = item => {
    const link = item.querySelector('a[href]');
    if (link) {
      try {
        const path = new URL(link.href, window.location.origin).pathname;
        if (classification[path]) return classification[path];
      } catch (_) {}
    }
    return 'strategy';
  };

  const itemGroups = items.map(getGroupId);
  const counts = groups.reduce((acc, group) => {
    acc[group.id] = group.id === 'all'
      ? items.length
      : itemGroups.filter(id => id === group.id).length;
    return acc;
  }, {});

  const controls = document.createElement('div');
  controls.className = 'publication-filters';
  controls.setAttribute('aria-label', 'Фильтр публикаций по аналитическому направлению');
  controls.innerHTML = groups.map((group, index) => `
    <button type="button" class="publication-filter${index === 0 ? ' is-active' : ''}" data-publication-filter="${group.id}" aria-pressed="${index === 0 ? 'true' : 'false'}">
      <span>${group.label}</span><span class="publication-filter-count">${counts[group.id]}</span>
    </button>
  `).join('');

  const intro = document.querySelector('.intro');
  if (!intro) return;
  intro.insertAdjacentElement('afterend', controls);

  const style = document.createElement('style');
  style.textContent = `
    .publication-filters{display:flex;flex-wrap:wrap;gap:10px;margin-top:34px;padding:14px 0 2px}
    .publication-filter{appearance:none;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:rgba(13,30,26,.72);color:var(--muted);padding:10px 14px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:.2s ease}
    .publication-filter:hover,.publication-filter.is-active{color:var(--text);border-color:var(--accent);background:rgba(199,164,90,.08)}
    .publication-filter-count{min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:999px;font-size:11px;line-height:1}
    .item.is-filtered-out{display:none}
    .publication-filter:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    @media(max-width:720px){.publication-filters{gap:8px;margin-top:24px}.publication-filter{font-size:12px;padding:9px 12px}}
  `;
  document.head.appendChild(style);

  const applyFilter = groupId => {
    const group = groups.find(item => item.id === groupId) || groups[0];
    items.forEach((item, index) => {
      const visible = group.id === 'all' || itemGroups[index] === group.id;
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
