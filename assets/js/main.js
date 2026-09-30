document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('.main-navigation a[href*="#"]');
  const navigationLinks = document.querySelectorAll('.main-navigation a[href]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-navigation');

  const AUDIENCE_KEY = 'zhakin_audience_events_v1';
  const MAX_EVENTS = 50;

  const recordAudienceEvent = (type, data = {}) => {
    try {
      const events = JSON.parse(sessionStorage.getItem(AUDIENCE_KEY) || '[]');
      events.push({ type, path: window.location.pathname, timestamp: new Date().toISOString(), ...data });
      sessionStorage.setItem(AUDIENCE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch (_) {}
  };

  recordAudienceEvent('page_view', { title: document.title });

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

  navigationLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (navigation?.classList.contains('active')) setMenuState(false);
    });
  });

  links.forEach(link => {
    link.addEventListener('click', event => {
      const url = new URL(link.href, window.location.href);
      const isSamePage = url.pathname === window.location.pathname;
      const target = document.querySelector(url.hash);
      recordAudienceEvent('navigation_click', { target: url.pathname + url.hash, label: link.textContent.trim().slice(0, 120) });
      if (url.hash === '#contacts') recordAudienceEvent('contact_interest', { source: 'navigation' });
      if (isSamePage && target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setMenuState(false);
      }
    });
  });

  document.addEventListener('click', event => {
    if (!navigation || !menuButton) return;
    const clickedLink = event.target.closest('a[href]');
    if (clickedLink) {
      const url = new URL(clickedLink.href, window.location.href);
      if (url.origin !== window.location.origin) recordAudienceEvent('outbound_click', { host: url.host, path: url.pathname });
      if (clickedLink.closest('#contacts')) {
        recordAudienceEvent('contact_action', {
          channel: url.protocol === 'mailto:' ? 'email' : url.host || url.protocol.replace(':', '')
        });
      }
    }
    const clickedInsideMenu = navigation.contains(event.target);
    const clickedButton = menuButton.contains(event.target);
    if (!clickedInsideMenu && !clickedButton) setMenuState(false);
  });

  const geography = [
    { name: 'Канада', x: 18, y: 31, note: 'международные деловые направления' },
    { name: 'Турция', x: 49, y: 43, note: 'торговое взаимодействие' },
    { name: 'Египет', x: 53, y: 55, note: 'экспортное направление · БРИКС' },
    { name: 'Израиль / Палестина', x: 56, y: 47, note: 'деловые контакты' },
    { name: 'Джибути', x: 60, y: 65, note: 'международная логистика' },
    { name: 'Эфиопия', x: 61, y: 70, note: 'международное сотрудничество · БРИКС' },
    { name: 'Индия', x: 69, y: 57, note: 'экспортное направление · БРИКС' },
    { name: 'Бангладеш', x: 73, y: 55, note: 'торговое взаимодействие' },
    { name: 'Беларусь', x: 48, y: 32, note: 'СНГ · международное взаимодействие' },
    { name: 'Казахстан', x: 58, y: 34, note: 'СНГ · торгово-экономическое взаимодействие' },
    { name: 'Кыргызстан', x: 63, y: 40, note: 'СНГ · международное сотрудничество' },
    { name: 'Узбекистан', x: 61, y: 46, note: 'СНГ · торгово-экономическое взаимодействие' },
    { name: 'Таджикистан', x: 64, y: 48, note: 'СНГ · международное сотрудничество' },
    { name: 'Армения', x: 52, y: 39, note: 'СНГ · международное сотрудничество' },
    { name: 'Азербайджан', x: 54, y: 38, note: 'СНГ · торгово-экономическое взаимодействие' },
    { name: 'Молдова', x: 47, y: 38, note: 'СНГ · международное взаимодействие' },
    { name: 'Туркменистан', x: 58, y: 47, note: 'СНГ · международное взаимодействие' },
    { name: 'Китай', x: 78, y: 39, note: 'БРИКС · стратегическое торговое направление' },
    { name: 'Бразилия', x: 32, y: 68, note: 'БРИКС · международное сотрудничество' },
    { name: 'ЮАР', x: 51, y: 79, note: 'БРИКС · международное сотрудничество' },
    { name: 'Иран', x: 59, y: 52, note: 'БРИКС · торгово-экономическое взаимодействие' },
    { name: 'ОАЭ', x: 57, y: 58, note: 'БРИКС · международная торговля' },
    { name: 'Индонезия', x: 82, y: 68, note: 'БРИКС · международная торговля' }
  ];

  const hero = document.querySelector('.hero');
  if (hero && !document.querySelector('#geography')) {
    const section = document.createElement('section');
    section.id = 'geography';
    section.className = 'geography-section';
    section.setAttribute('aria-labelledby', 'geography-title');
    const markers = geography.map((place, index) => `
      <button class="geo-marker" type="button" style="--x:${place.x}%;--y:${place.y}%" aria-label="${place.name}: ${place.note}" data-geo-index="${index}">
        <span class="geo-dot" aria-hidden="true"></span><span class="geo-label">${place.name}</span>
      </button>`).join('');
    section.innerHTML = `
      <div class="geography-inner">
        <div class="geography-heading">
          <span class="eyebrow">GLOBAL BUSINESS NETWORK</span>
          <h2 id="geography-title">География международного взаимодействия</h2>
          <p>Карта-схема публично показывает ключевые международные направления, страны СНГ и рынки БРИКС. Персональные данные и закрытые контакты не публикуются.</p>
          <p><a href="/international-geography.html">Открыть структурированный обзор международной географии →</a></p>
        </div>
        <div class="geo-map" role="img" aria-label="Схематическая карта международных деловых направлений, стран СНГ и рынков БРИКС">
          <div class="geo-grid" aria-hidden="true"></div><div class="geo-orbit geo-orbit-a" aria-hidden="true"></div>
          <div class="geo-orbit geo-orbit-b" aria-hidden="true"></div><div class="geo-route geo-route-a" aria-hidden="true"></div>
          <div class="geo-route geo-route-b" aria-hidden="true"></div>${markers}
        </div>
        <div class="geo-legend"><span><i></i> международные деловые направления</span><span><i></i> СНГ · торговля и сотрудничество</span><span><i></i> БРИКС · торгово-экономические связи</span></div>
      </div>`;
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

  // Премиальный блок глобальных котировок: интерактивная карта/список мировых рынков.
  if (!document.getElementById('zhakin-global-markets')) {
    const markets = document.createElement('section');
    markets.id = 'zhakin-global-markets';
    markets.className = 'markets-section';
    markets.setAttribute('aria-labelledby', 'markets-title');
    markets.innerHTML = `
      <div class="markets-inner">
        <div class="markets-heading">
          <span class="eyebrow">GLOBAL MARKETS • LIVE QUOTES</span>
          <h2 id="markets-title">Мировые рынки</h2>
          <p>Глобальный рыночный контур платформы: мировые индексы, криптовалюты, золото, нефть, газ, валюты и другие ключевые финансовые инструменты. Можно переключаться между картой и подробным списком.</p>
        </div>
        <div class="markets-panel">
          <div class="markets-widget" id="zhakin-markets-widget"></div>
          <div class="markets-data">
            <div class="markets-data-label">Индексы · Крипто · Сырьё · Валюты · Облигации</div>
            <div class="markets-data-widget" id="zhakin-markets-data"></div>
          </div>
        </div>
        <div class="markets-note">
          <span>Данные и котировки предоставляются внешним поставщиком рыночных данных.</span>
          <span><a href="https://www.tradingview.com/" target="_blank" rel="noopener nofollow">Источник данных: TradingView</a></span>
        </div>
      </div>`;
    const geographySection = document.getElementById('geography');
    if (geographySection) geographySection.insertAdjacentElement('afterend', markets);
    else if (hero) hero.insertAdjacentElement('afterend', markets);

    const mountMarketsWidget = () => {
      const host = document.getElementById('zhakin-markets-widget');
      if (!host || customElements.get('tv-world-market-summary')) return;
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://widgets.tradingview-widget.com/w/en/tv-world-market-summary.js';
      script.async = true;
      document.head.appendChild(script);
      const widget = document.createElement('tv-world-market-summary');
      widget.setAttribute('theme', 'dark');
      widget.setAttribute('transparent-background', '');
      host.appendChild(widget);
    };
    mountMarketsWidget();

    const mountMarketData = () => {
      const host = document.getElementById('zhakin-markets-data');
      if (!host || customElements.get('tv-market-data')) return;
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://widgets.tradingview-widget.com/w/en/tv-market-data.js';
      script.async = true;
      document.head.appendChild(script);
      const widget = document.createElement('tv-market-data');
      widget.setAttribute('theme', 'dark');
      widget.setAttribute('transparent-background', '');
      widget.setAttribute('symbol-sectors', JSON.stringify([
        { sectionName: 'Индексы', symbols: ['FOREXCOM:SPXUSD','FOREXCOM:NSXUSD','FOREXCOM:DJI','INDEX:NKY','INDEX:DEU40','FOREXCOM:UKXGBP'] },
        { sectionName: 'Криптовалюты', symbols: ['BINANCE:BTCUSDT','BINANCE:ETHUSDT','COINBASE:SOLUSD','BINANCE:BNBUSDT','BINANCE:XRPUSDT'] },
        { sectionName: 'Сырьё', symbols: ['TVC:GOLD','TVC:SILVER','TVC:USOIL','TVC:UKOIL','NYMEX:NG1!'] },
        { sectionName: 'Валюты', symbols: ['FX:EURUSD','FX:GBPUSD','FX:USDJPY','FX:USDCHF','FX:USDCNY','FX:USDTRY'] },
        { sectionName: 'Облигации', symbols: ['TVC:US10Y','TVC:DE10Y','TVC:JP10Y'] },
        { sectionName: 'Облигации РФ', symbols: ['RUS:RGBI','RUS:RGBITR','RUS:RUGBITR10Y'] }
      ]));
      host.appendChild(widget);
    };
    mountMarketData();
  }

  if (!document.getElementById('zhakin-ai-widget')) {
    const style = document.createElement('style');
    style.textContent = `
      #zhakin-ai-widget{position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:inherit}
      #zhakin-ai-launcher{pointer-events:auto;position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:8px;border:1px solid rgba(212,175,55,.55);border-radius:14px;padding:6px 11px 6px 6px;background:#071a15;color:#f4f1e8;box-shadow:0 12px 34px rgba(0,0,0,.32);cursor:pointer;font:800 12px/1 inherit;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
      #zhakin-ai-launcher:hover{border-color:#d4af37;transform:translateY(-2px);box-shadow:0 15px 38px rgba(0,0,0,.38)}
      .zhakin-ai-robot{position:relative;width:31px;height:31px;flex:0 0 31px;border-radius:9px 7px 10px 10px;background:linear-gradient(135deg,#1b302b 0%,#0a1814 68%);border:1px solid rgba(212,175,55,.7);box-shadow:inset -5px 0 0 rgba(0,0,0,.13),inset 0 -5px 0 rgba(0,0,0,.14),0 4px 12px rgba(0,0,0,.28);overflow:visible}
      .zhakin-ai-robot:before{content:"";position:absolute;left:5px;top:7px;width:16px;height:11px;border:1px solid rgba(212,175,55,.78);border-radius:5px 3px 3px 5px;background:#050e0b;box-shadow:inset 0 0 8px rgba(31,199,143,.09)}
      .zhakin-ai-robot:after{content:"•";position:absolute;left:11px;top:6px;color:#d4af37;font-size:12px;line-height:10px;text-shadow:0 0 7px rgba(212,175,55,.55)}
      .zhakin-ai-antenna{position:absolute;width:2px;height:7px;left:18px;top:-6px;border-radius:3px;background:#d4af37;transform:rotate(22deg);transform-origin:bottom}
      .zhakin-ai-antenna:after{content:"";position:absolute;width:5px;height:5px;left:-2px;top:-4px;border-radius:50%;background:#d4af37;box-shadow:0 0 8px rgba(212,175,55,.55)}
      .zhakin-ai-robot .zhakin-ai-antenna:before{content:"";position:absolute;width:3px;height:13px;right:-7px;bottom:-1px;border-radius:3px;background:rgba(212,175,55,.42);box-shadow:0 2px 0 rgba(212,175,55,.35)}
      .zhakin-ai-panel{display:none}
      #zhakin-ai-panel[hidden]{display:none!important}#zhakin-ai-panel{position:fixed;right:18px;bottom:76px;width:min(360px,calc(100vw - 28px));margin:0;pointer-events:auto;border:1px solid rgba(212,175,55,.3);border-radius:18px;background:#081a16;color:#f4f1e8;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden}
      #zhakin-ai-panel.is-open{display:block}
      .zhakin-ai-head{display:flex;align-items:center;justify-content:space-between;padding:14px 15px;border-bottom:1px solid rgba(212,175,55,.18)}
      .zhakin-ai-title{display:flex;align-items:center;gap:9px;font-weight:800;font-size:14px}
      .zhakin-ai-title small{display:block;margin-top:2px;color:rgba(244,241,232,.55);font-size:11px;font-weight:400}
      .zhakin-ai-head-robot{width:25px;height:25px;border-radius:7px 5px 8px 8px;background:linear-gradient(135deg,#173027,#0a1814);border:1px solid rgba(212,175,55,.55);position:relative;overflow:visible}
      .zhakin-ai-head-robot:before{content:"";position:absolute;left:5px;top:6px;width:13px;height:8px;border:1px solid #d4af37;border-radius:4px 2px 2px 4px}
      .zhakin-ai-head-robot:after{content:"•";position:absolute;left:10px;top:2px;color:#d4af37;font-size:9px;line-height:9px}
      #zhakin-ai-close{border:0;background:transparent;color:rgba(244,241,232,.7);font-size:20px;cursor:pointer}
      .zhakin-ai-status{padding:10px 15px;color:rgba(244,241,232,.62);font-size:11px;line-height:1.45;border-bottom:1px solid rgba(212,175,55,.12)}
      #zhakin-ai-messages{max-height:250px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:9px}
      .zhakin-ai-msg{max-width:88%;padding:10px 12px;border-radius:13px;font-size:13px;line-height:1.45;white-space:pre-wrap}
      .zhakin-ai-msg.system{align-self:flex-start;background:rgba(244,241,232,.045);border:1px solid rgba(212,175,55,.14)}
      .zhakin-ai-msg.user{align-self:flex-end;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.24)}
      .zhakin-ai-form{display:flex;gap:8px;padding:11px;border-top:1px solid rgba(212,175,55,.14)}
      #zhakin-ai-input{min-width:0;flex:1;min-height:42px;max-height:100px;resize:vertical;border-radius:11px;border:1px solid rgba(212,175,55,.25);background:#06130f;color:#f4f1e8;padding:10px;font:inherit;font-size:13px}
      #zhakin-ai-input:focus{outline:2px solid rgba(212,175,55,.4);outline-offset:1px}
      #zhakin-ai-submit{border:1px solid #d4af37;border-radius:11px;background:#d4af37;color:#071a16;padding:0 12px;font-weight:800;cursor:pointer}
      #zhakin-ai-submit:disabled{opacity:.42;cursor:not-allowed}
      .zhakin-ai-links{padding:0 13px 12px;font-size:11px}.zhakin-ai-links a{color:#d4af37;text-decoration:none}
      @media(max-width:520px){#zhakin-ai-launcher{right:10px;bottom:max(10px,env(safe-area-inset-bottom));padding:5px 9px 5px 5px}.zhakin-ai-robot{width:28px;height:28px;flex-basis:28px}#zhakin-ai-panel{right:10px;bottom:64px;width:calc(100vw - 20px)}#zhakin-ai-messages{max-height:32vh}}
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'zhakin-ai-widget';
    widget.innerHTML = `
      <div id="zhakin-ai-panel" hidden role="dialog" aria-label="ЖАК">
        <div class="zhakin-ai-head">
          <div class="zhakin-ai-title"><span class="zhakin-ai-head-robot" aria-hidden="true"></span><span>ЖАК<small>Жакин AI · цифровой помощник</small></span></div>
          <button id="zhakin-ai-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="zhakin-ai-status" id="zhakin-ai-status">Готов к диалогу. Нажмите на ЖАК, чтобы открыть помощника.</div>
        <div id="zhakin-ai-messages" aria-live="polite"><div class="zhakin-ai-msg system">Здравствуйте. Я ЖАК — цифровой помощник Жакин.рф. Помогу найти информацию на сайте и покажу источники.</div></div>
        <form class="zhakin-ai-form" id="zhakin-ai-form">
          <textarea id="zhakin-ai-input" rows="1" placeholder="Задайте вопрос…" aria-label="Вопрос для ЖАК"></textarea>
          <button id="zhakin-ai-submit" type="submit">→</button>
        </form>
        <div class="zhakin-ai-links"><a href="/intelligence.html">Открыть полный режим →</a></div>
      </div>
      <button id="zhakin-ai-launcher" type="button" aria-expanded="false" aria-controls="zhakin-ai-panel" aria-label="Открыть ЖАК">
        <span class="zhakin-ai-robot" aria-hidden="true"><span class="zhakin-ai-antenna"></span></span><span>ЖАК</span>
      </button>
    `;
    document.body.appendChild(widget);

    const panel = document.getElementById('zhakin-ai-panel');
    const launcher = document.getElementById('zhakin-ai-launcher');
    const close = document.getElementById('zhakin-ai-close');
    const form = document.getElementById('zhakin-ai-form');
    const input = document.getElementById('zhakin-ai-input');
    const submit = document.getElementById('zhakin-ai-submit');
    const status = document.getElementById('zhakin-ai-status');
    const messages = document.getElementById('zhakin-ai-messages');
    let endpoint = null;

    const addAiMessage = (text, role='system') => {
      const el = document.createElement('div');
      el.className = 'zhakin-ai-msg ' + role;
      el.textContent = text;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    };

    const closeAi = () => {
      panel.classList.remove('is-open');
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', 'Открыть ЖАК');
    };

    const openAi = () => {
      panel.hidden = false;
      panel.classList.add('is-open');
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', 'Закрыть ЖАК');
      loadAiConfig();
      setTimeout(() => input.focus(), 50);
    };

    // ЖАК всегда стартует закрытым и остаётся в нижнем правом углу.
    closeAi();

    launcher.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panel.classList.contains('is-open')) {
        closeAi();
      } else {
        openAi();
      }
    });

    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAi();
      launcher.focus();
    });

    document.addEventListener('click', event => {
      if (panel.hidden || !panel.classList.contains('is-open')) return;
      if (!widget.contains(event.target)) closeAi();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) {
        closeAi();
        launcher.focus();
      }
    });

    const loadAiConfig = async () => {
      try {
        const response = await fetch('/data/intelligence-config.json', {cache:'no-store'});
        if (!response.ok) throw new Error('config');
        const config = await response.json();
        endpoint = typeof config.endpoint === 'string' && config.endpoint.trim() ? config.endpoint.trim() : null;
        status.textContent = endpoint
          ? 'Контур подключён. Можно задавать вопросы.'
          : 'Интерфейс готов. Серверный AI пока не подключён; API-ключ не хранится в браузере.';
        submit.disabled = false;
      } catch (_) {
        status.textContent = 'Конфигурация помощника временно недоступна.';
      }
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      if (!endpoint) {
        addAiMessage('Сейчас доступен интерфейс помощника, но серверный AI-контур ещё не подключён. Как только безопасный backend будет активирован, здесь можно будет получать ответы с источниками.', 'system');
        return;
      }
      addAiMessage(question, 'user');
      input.value = '';
      input.disabled = true;
      submit.disabled = true;
      try {
        const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})});
        if (!response.ok) throw new Error('request');
        const data = await response.json();
        addAiMessage(typeof data.answer === 'string' ? data.answer : 'Сервис вернул неподдерживаемый формат ответа.');
        if (Array.isArray(data.sources) && data.sources.length) {
          data.sources.forEach(source => {
            if (!source || !source.url) return;
            const link = document.createElement('a');
            link.href = source.url;
            link.textContent = source.title || source.url;
            link.target = '_blank';
            link.rel = 'noopener';
            const wrap = document.createElement('div');
            wrap.className = 'zhakin-ai-links';
            wrap.appendChild(link);
            messages.appendChild(wrap);
          });
        }
      } catch (_) {
        addAiMessage('Не удалось получить ответ от AI-сервера. Попробуйте ещё раз позже.');
      } finally {
        input.disabled = false;
        submit.disabled = false;
        input.focus();
      }
    });
  }

  if (!document.getElementById('zhakin-accessibility')) {
    const accessibility = document.createElement('div');
    accessibility.id = 'zhakin-accessibility';
    accessibility.setAttribute('aria-label', 'Настройки отображения');
    accessibility.innerHTML = `
      <button type="button" data-a11y="decrease" aria-label="Уменьшить размер текста" title="Уменьшить текст">A−</button>
      <button type="button" data-a11y="reset" aria-label="Сбросить размер текста" title="Сбросить размер текста">A</button>
      <button type="button" data-a11y="increase" aria-label="Увеличить размер текста" title="Увеличить текст">A+</button>
    `;
    if (menuButton && menuButton.parentElement) {
      menuButton.parentElement.insertBefore(accessibility, menuButton);
    } else {
      document.body.appendChild(accessibility);
    }

    const A11Y_KEY = 'zhakin_text_scale_v1';
    const clampScale = value => Math.min(1.18, Math.max(0.92, Number(value) || 1));
    const applyScale = value => {
      const scale = clampScale(value);
      document.documentElement.style.setProperty('--zhakin-text-scale', String(scale));
      try { localStorage.setItem(A11Y_KEY, String(scale)); } catch (_) {}
    };

    let initialScale = 1;
    try { initialScale = clampScale(localStorage.getItem(A11Y_KEY)); } catch (_) {}
    applyScale(initialScale);

    accessibility.addEventListener('click', event => {
      const button = event.target.closest('button[data-a11y]');
      if (!button) return;
      const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zhakin-text-scale')) || 1;
      const action = button.dataset.a11y;
      applyScale(action === 'increase' ? current + 0.06 : action === 'decrease' ? current - 0.06 : 1);
      recordAudienceEvent('accessibility_text_scale', { scale: getComputedStyle(document.documentElement).getPropertyValue('--zhakin-text-scale') });
    });
  }

});