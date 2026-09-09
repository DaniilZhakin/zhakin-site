document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('.main-navigation a[href*="#"]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-navigation');

  const AUDIENCE_KEY = 'zhakin_audience_events_v1';
  const MAX_EVENTS = 50;

  // Privacy-first instrumentation: events stay in the visitor's browser.
  // No IP address, fingerprint, form content, or personally identifiable data is collected.
  const recordAudienceEvent = (type, data = {}) => {
    try {
      const events = JSON.parse(sessionStorage.getItem(AUDIENCE_KEY) || '[]');
      events.push({
        type,
        path: window.location.pathname,
        timestamp: new Date().toISOString(),
        ...data
      });
      sessionStorage.setItem(AUDIENCE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch (_) {
      // Storage may be unavailable; site functionality must never depend on analytics.
    }
  };

  recordAudienceEvent('page_view', {
    title: document.title
  });

  const setMenuState = (isOpen) => {
    if (!navigation || !menuButton) return;

    navigation.classList.toggle('active', isOpen);
    menuButton.classList.toggle('active', isOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
  };

  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      const isOpen = navigation.classList.contains('active');
      setMenuState(!isOpen);
      recordAudienceEvent('menu_toggle', { state: !isOpen ? 'open' : 'close' });
    });
  }

  links.forEach(link => {
    link.addEventListener('click', event => {
      const url = new URL(link.href, window.location.href);
      const isSamePage = url.pathname === window.location.pathname;
      const target = document.querySelector(url.hash);

      recordAudienceEvent('navigation_click', {
        target: url.pathname + url.hash,
        label: link.textContent.trim().slice(0, 120)
      });

      if (url.hash === '#contacts') {
        recordAudienceEvent('contact_interest', {
          source: 'navigation'
        });
      }

      if (isSamePage && target) {
        event.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        setMenuState(false);
      }
    });
  });

  document.addEventListener('click', event => {
    if (!navigation || !menuButton) return;

    const clickedLink = event.target.closest('a[href]');
    if (clickedLink) {
      const url = new URL(clickedLink.href, window.location.href);
      const isExternal = url.origin !== window.location.origin;

      if (isExternal) {
        recordAudienceEvent('outbound_click', {
          host: url.host,
          path: url.pathname
        });
      }

      if (clickedLink.closest('#contacts')) {
        recordAudienceEvent('contact_action', {
          channel: url.protocol === 'mailto:' ? 'email' : url.host || url.protocol.replace(':', '')
        });
      }
    }

    const clickedInsideMenu = navigation.contains(event.target);
    const clickedButton = menuButton.contains(event.target);

    if (!clickedInsideMenu && !clickedButton) {
      setMenuState(false);
    }
  });

  // Public, privacy-safe geography layer: countries/markets only, no private contact data.
  const geography = [
    { name: 'Канада', x: 18, y: 31, note: 'международные деловые направления' },
    { name: 'Турция', x: 49, y: 43, note: 'торговое взаимодействие' },
    { name: 'Египет', x: 53, y: 55, note: 'экспортное направление' },
    { name: 'Израиль / Палестина', x: 56, y: 47, note: 'деловые контакты' },
    { name: 'Джибути', x: 60, y: 65, note: 'международная логистика' },
    { name: 'Эфиопия', x: 61, y: 70, note: 'международное сотрудничество' },
    { name: 'Индия', x: 69, y: 57, note: 'экспортное направление' },
    { name: 'Бангладеш', x: 73, y: 55, note: 'торговое взаимодействие' }
  ];

  const hero = document.querySelector('.hero');
  if (hero && !document.querySelector('#geography')) {
    const section = document.createElement('section');
    section.id = 'geography';
    section.className = 'geography-section';
    section.setAttribute('aria-labelledby', 'geography-title');

    const markers = geography.map((place, index) => `
      <button class="geo-marker" type="button" style="--x:${place.x}%;--y:${place.y}%" aria-label="${place.name}: ${place.note}" data-geo-index="${index}">
        <span class="geo-dot" aria-hidden="true"></span>
        <span class="geo-label">${place.name}</span>
      </button>
    `).join('');

    section.innerHTML = `
      <div class="geography-inner">
        <div class="geography-heading">
          <span class="eyebrow">GLOBAL BUSINESS NETWORK</span>
          <h2 id="geography-title">География международного взаимодействия</h2>
          <p>Карта-схема публично показывает ключевые международные направления и деловые точки взаимодействия. Персональные данные и закрытые контакты не публикуются.</p>
        </div>
        <div class="geo-map" role="img" aria-label="Схематическая карта международных деловых направлений">
          <div class="geo-grid" aria-hidden="true"></div>
          <div class="geo-orbit geo-orbit-a" aria-hidden="true"></div>
          <div class="geo-orbit geo-orbit-b" aria-hidden="true"></div>
          <div class="geo-route geo-route-a" aria-hidden="true"></div>
          <div class="geo-route geo-route-b" aria-hidden="true"></div>
          ${markers}
        </div>
        <div class="geo-legend">
          <span><i></i> международные деловые направления</span>
          <span><i></i> торговое и экспортное взаимодействие</span>
          <span><i></i> логистические и партнёрские связи</span>
        </div>
      </div>
    `;

    hero.insertAdjacentElement('afterend', section);

    section.querySelectorAll('.geo-marker').forEach(marker => {
      marker.addEventListener('click', () => {
        const place = geography[Number(marker.dataset.geoIndex)];
        recordAudienceEvent('geography_interest', { country: place.name });
        section.querySelectorAll('.geo-marker').forEach(item => item.classList.remove('is-active'));
        marker.classList.add('is-active');
      });
    });
  }
});
