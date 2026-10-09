(() => {
  const statusEl = document.getElementById('ai-status');
  const form = document.getElementById('ai-form');
  const input = document.getElementById('ai-input');
  const submit = document.getElementById('ai-submit');
  const messages = document.getElementById('ai-messages');
  const sources = document.getElementById('ai-sources');
  const topics = document.querySelectorAll('.ai-topic');

  let endpoint = null;

  const addMessage = (text, role) => {
    const el = document.createElement('div');
    el.className = 'ai-message ' + role;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  };

  const addSection = (heading, content) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-message system';
    const title = document.createElement('strong');
    title.textContent = heading;
    wrapper.appendChild(title);
    if (typeof content === 'string') {
      const p = document.createElement('p');
      p.textContent = content;
      wrapper.appendChild(p);
    } else if (content) {
      wrapper.appendChild(content);
    }
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
  };

  const renderToolsResult = data => {
    if (data.library && Array.isArray(data.library.matches)) {
      const matches = data.library.matches;
      if (matches.length) {
        const list = document.createElement('ul');
        matches.forEach(match => {
          const item = document.createElement('li');
          item.textContent = (match.path ? match.path + ': ' : '') + (match.excerpt || 'Найден фрагмент библиотеки');
          list.appendChild(item);
        });
        addSection('Библиотека знаний сайта', list);
      } else {
        addSection('Библиотека знаний сайта', 'По формулировке вопроса точные совпадения не найдены. Попробуйте уточнить тему или используйте внешние источники ниже.');
      }
      const unavailable = Object.entries(data.library.status || {}).filter(([, ok]) => !ok).map(([key]) => key);
      if (unavailable.length) addSection('Часть источников библиотеки недоступна', unavailable.join(', '));
    }

    if (data.analytics) {
      if (data.analytics.available && data.analytics.data) {
        addSection('PostHog · последние 7 дней', JSON.stringify(data.analytics.data, null, 2));
      } else if (data.analytics.configured) {
        addSection('PostHog', 'Подключение настроено, но данные сейчас недоступны. Проверьте права API-ключа и Project ID в настройках production.');
      } else {
        addSection('PostHog', 'Серверные параметры PostHog ещё не настроены в Cloudflare Worker.');
      }
    }

    const results = data.external_search && Array.isArray(data.external_search.results)
      ? data.external_search.results : [];
    sources.textContent = '';
    if (results.length) {
      const heading = document.createElement('strong');
      heading.textContent = 'Внешние источники: ';
      sources.appendChild(heading);
      results.forEach((source, index) => {
        if (!source || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url)) return;
        if (index) sources.appendChild(document.createTextNode(' · '));
        const link = document.createElement('a');
        link.href = source.url;
        link.textContent = source.title || source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        sources.appendChild(link);
      });
    }
    if (!data.library && !data.analytics && !data.external_search) {
      addMessage('Сервис вернул ответ в неподдерживаемом формате.', 'system');
    }
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('/data/intelligence-config.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('config unavailable');
      const config = await response.json();
      endpoint = typeof config.endpoint === 'string' && config.endpoint.trim() ? config.endpoint.trim() : null;
      if (endpoint) {
        statusEl.textContent = 'ЖАК подключён к серверному контуру библиотеки и инструментов.';
        submit.disabled = false;
      } else {
        statusEl.textContent = 'Интерфейс готов. Ожидается адрес развёрнутого серверного контура ЖАК.';
      }
    } catch (error) {
      statusEl.textContent = 'Конфигурация подключения временно недоступна.';
    }
  };

  const ask = async question => {
    if (!endpoint) {
      addMessage('Серверный контур ещё не подключён: сначала необходимо развернуть Worker и указать его реальный адрес. Ключи API в браузер не передаются.', 'system');
      return;
    }
    addMessage(question, 'user');
    submit.disabled = true;
    input.disabled = true;
    sources.textContent = '';
    try {
      const response = await fetch(endpoint.replace(/\/$/, '') + '/v1/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'tools request failed');
      renderToolsResult(data);
    } catch (error) {
      addMessage('Не удалось получить данные от серверного контура ЖАК. Проверьте доступность Worker и настройки PostHog.', 'system');
    } finally {
      submit.disabled = !endpoint;
      input.disabled = false;
      input.focus();
    }
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    ask(question);
  });

  topics.forEach(topic => topic.addEventListener('click', () => {
    input.value = topic.textContent.trim();
    input.focus();
  }));

  loadConfig();
})();
