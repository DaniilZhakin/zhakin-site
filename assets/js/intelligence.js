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
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('/data/intelligence-config.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('config unavailable');
      const config = await response.json();
      endpoint = typeof config.endpoint === 'string' && config.endpoint.trim() ? config.endpoint.trim() : null;
      if (endpoint) {
        statusEl.textContent = 'Контур подключения найден. Можно задавать вопросы.';
        submit.disabled = false;
      } else {
        statusEl.textContent = 'Интерфейс готов. Безопасный серверный AI-контур пока не подключён: ключ модели не хранится в браузере.';
      }
    } catch (error) {
      statusEl.textContent = 'Конфигурация AI временно недоступна. Интерфейс сохранён в безопасном режиме.';
    }
  };

  const ask = async (question) => {
    if (!endpoint) {
      addMessage('AI-контур ещё не подключён. Сейчас подготовлен интерфейс и схема безопасного подключения; API-ключ не размещается в коде сайта.', 'system');
      return;
    }
    addMessage(question, 'user');
    submit.disabled = true;
    input.disabled = true;
    sources.textContent = '';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ question })
      });
      if (!response.ok) throw new Error('AI request failed');
      const data = await response.json();
      addMessage(typeof data.answer === 'string' ? data.answer : 'Сервис вернул ответ в неподдерживаемом формате.', 'system');
      if (Array.isArray(data.sources) && data.sources.length) {
        sources.innerHTML = '<strong>Источники:</strong> ' + data.sources.map(source => {
          const a = document.createElement('a');
          a.href = source.url;
          a.textContent = source.title || source.url;
          a.target = '_blank';
          a.rel = 'noopener';
          return a.outerHTML;
        }).join('');
      }
    } catch (error) {
      addMessage('Не удалось получить ответ от AI-сервера. Попробуйте ещё раз позже.', 'system');
    } finally {
      submit.disabled = false;
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