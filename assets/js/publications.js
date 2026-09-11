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

  const groupLabels = Object.fromEntries(groups.map(group => [group.id, group.label]));

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
    acc[group.id] = group.id === 'all' ? items.length : itemGroups.filter(id => id === group.id).length;
    return acc;
  }, {});

  const publicationData = items.map((item, index) => {
    const link = item.querySelector('a[href]');
    const title = item.querySelector('h2')?.textContent?.trim() || 'Материал';
    let path = '#';
    if (link) {
      try { path = new URL(link.href, window.location.origin).pathname; } catch (_) { path = link.getAttribute('href') || '#'; }
    }
    return { index, path, title, group: itemGroups[index] };
  });

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

  const directionLink = document.createElement('a');
  directionLink.className = 'publication-directions-link';
  directionLink.href = '/publications/directions.html';
  directionLink.textContent = 'Открыть карту аналитических направлений →';
  controls.insertAdjacentElement('afterend', directionLink);

  const style = document.createElement('style');
  style.textContent = `
    .publication-filters{display:flex;flex-wrap:wrap;gap:10px;margin-top:34px;padding:14px 0 2px}
    .publication-filter{appearance:none;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:rgba(13,30,26,.72);color:var(--muted);padding:10px 14px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:.2s ease}
    .publication-filter:hover,.publication-filter.is-active{color:var(--text);border-color:var(--accent);background:rgba(199,164,90,.08)}
    .publication-filter-count{min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:999px;font-size:11px;line-height:1}
    .publication-filter:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .publication-directions-link{display:inline-flex;margin-top:12px;color:var(--accent);font-size:13px;font-weight:700}
    .publication-directions-link:hover{color:var(--gold-soft)}
    .item.is-filtered-out{display:none}
    .related-materials{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
    .related-materials-label{margin:0 0 9px;color:var(--gold-soft);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
    .related-materials-direction{margin:0 0 10px;color:var(--muted);font-size:12px}
    .related-materials-list{display:flex;flex-wrap:wrap;gap:7px}
    .related-material{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:7px 10px;color:var(--text);font-size:12px;background:rgba(8,17,15,.42);transition:.2s ease}
    .related-material:hover{border-color:var(--accent);color:var(--gold-soft)}
    @media(max-width:720px){.publication-filters{gap:8px;margin-top:24px}.publication-filter{font-size:12px;padding:9px 12px}.related-materials{margin-top:18px}.related-material{font-size:11px}}
  `;
  document.head.appendChild(style);

  items.forEach((item, index) => {
    const data = publicationData[index];
    const related = publicationData.filter(candidate => candidate.group === data.group && candidate.path !== data.path).slice(0, 3);
    if (!related.length) return;

    const body = item.querySelector('.body');
    if (!body) return;

    const section = document.createElement('div');
    section.className = 'related-materials';
    section.innerHTML = `
      <p class="related-materials-label">Связанные материалы</p>
      <p class="related-materials-direction">Аналитическое направление: ${groupLabels[data.group]}</p>
      <div class="related-materials-list">
        ${related.map(material => `<a class="related-material" href="${material.path}">${material.title}</a>`).join('')}
      </div>
    `;
    body.appendChild(section);
  });

  const applyFilter = groupId => {
    const group = groups.find(item => item.id === groupId) || groups[0];
    items.forEach((item, index) => item.classList.toggle('is-filtered-out', !(group.id === 'all' || itemGroups[index] === group.id)));
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

  const requestedDirection = new URLSearchParams(window.location.search).get('direction');
  if (requestedDirection && groups.some(group => group.id === requestedDirection)) {
    applyFilter(requestedDirection);
  }
});
