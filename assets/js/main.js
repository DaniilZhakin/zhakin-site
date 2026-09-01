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
    if (clickedLink && !clickedLink.classList.contains('main-navigation')) {
      const url = new URL(clickedLink.href, window.location.href);
      const isExternal = url.origin !== window.location.origin;
      if (isExternal) {
        recordAudienceEvent('outbound_click', {
          host: url.host,
          path: url.pathname
        });
      }
    }

    const clickedInsideMenu = navigation.contains(event.target);
    const clickedButton = menuButton.contains(event.target);

    if (!clickedInsideMenu && !clickedButton) {
      setMenuState(false);
    }
  });
});
