(function (root) {
  'use strict';

  const STORAGE_KEY = 'zhakin_valuation_analytical_handoff_v1';
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const KINDS = ['business', 'property', 'equipment'];
  const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function buildBrief(input, now) {
    if (!input || !KINDS.includes(input.kind)) throw new Error('Неизвестный тип актива.');
    const value = finiteOrNull(input.value);
    if (value === null || value <= 0) throw new Error('Нет корректного результата оценки.');
    const currency = String(input.currency || '');
    if (!CURRENCIES.includes(currency)) throw new Error('Неподдерживаемая валюта.');
    const assessmentDate = String(input.assessmentDate || '');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(assessmentDate)) throw new Error('Укажите корректную дату оценки.');
    const createdAt = new Date(now === undefined ? Date.now() : now).toISOString();
    const low = finiteOrNull(input.low);
    const high = finiteOrNull(input.high);
    const stressPct = Number(input.stressPct);
    const optimisticPct = Number(input.optimisticPct);
    const scenarios = Number.isFinite(stressPct) && Number.isFinite(optimisticPct) &&
      stressPct <= 0 && optimisticPct >= 0
      ? [
          { label: 'Стрессовый', changePct: stressPct, value: value * (1 + stressPct / 100) },
          { label: 'Базовый', changePct: 0, value },
          { label: 'Оптимистичный', changePct: optimisticPct, value: value * (1 + optimisticPct / 100) }
        ]
      : [];
    return {
      schemaVersion: 1,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + MAX_AGE_MS).toISOString(),
      kind: input.kind,
      method: String(input.method || 'Метод не указан').slice(0, 180),
      value,
      low,
      high,
      currency,
      assessmentDate,
      scenarios
    };
  }

  function saveBrief(storage, input, now) {
    const brief = buildBrief(input, now);
    storage.setItem(STORAGE_KEY, JSON.stringify(brief));
    return brief;
  }

  function readBrief(storage, now) {
    let brief;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      brief = JSON.parse(raw);
    } catch (_) {
      clearBrief(storage);
      return null;
    }
    const current = now === undefined ? Date.now() : Number(now);
    const expires = Date.parse(brief.expiresAt || '');
    if (brief.schemaVersion !== 1 || !Number.isFinite(expires) || expires <= current ||
        !KINDS.includes(brief.kind) || !CURRENCIES.includes(brief.currency) ||
        !Number.isFinite(Number(brief.value)) || Number(brief.value) <= 0) {
      clearBrief(storage);
      return null;
    }
    return brief;
  }

  function clearBrief(storage) {
    storage.removeItem(STORAGE_KEY);
  }

  function initCalculator(document) {
    const button = document.getElementById('send-valuation-brief');
    if (!button) return;
    let latest = null;
    button.disabled = true;
    button.addEventListener('click', function () {
      if (!latest) return;
      try {
        saveBrief(root.sessionStorage, latest);
        window.location.href = '/centers/analytical/#valuation-brief';
      } catch (_) {
        const status = document.getElementById('valuation-handoff-status');
        if (status) status.textContent = 'Не удалось передать сводку в этой вкладке. Проверьте настройки хранения браузера.';
      }
    });
    root.ZhakinValuationHandoff.setLatest = function (input) {
      latest = input;
      button.disabled = !input;
      const status = document.getElementById('valuation-handoff-status');
      if (status) status.textContent = input
        ? 'Готова краткая сводка. Исходные поля калькулятора не передаются.'
        : 'Сначала выполните расчёт.';
    };
  }

  function initAnalytical(document) {
    const panel = document.getElementById('valuation-brief');
    if (!panel) return;
    const content = panel.querySelector('[data-valuation-brief-content]');
    const clear = panel.querySelector('[data-clear-valuation-brief]');
    const status = panel.querySelector('[data-valuation-brief-status]');
    const brief = readBrief(root.sessionStorage);
    if (!brief) {
      panel.hidden = true;
      return;
    }
    const format = value => new Intl.NumberFormat('ru-RU', {
      style: 'currency', currency: brief.currency, maximumFractionDigits: 2
    }).format(value);
    const rows = [
      ['Тип актива', ({ business: 'Бизнес', property: 'Недвижимость', equipment: 'Оборудование' })[brief.kind]],
      ['Метод', brief.method],
      ['Расчётный ориентир', format(brief.value)],
      ['Нижний ориентир', brief.low === null ? 'Не рассчитан' : format(brief.low)],
      ['Верхний ориентир', brief.high === null ? 'Не рассчитан' : format(brief.high)],
      ['Дата оценки', brief.assessmentDate]
    ];
    content.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'ac-valuation-row';
      const name = document.createElement('span');
      name.textContent = label;
      const result = document.createElement('strong');
      result.textContent = value;
      row.append(name, result);
      content.append(row);
    });
    if (brief.scenarios.length) {
      const heading = document.createElement('h3');
      heading.textContent = 'Сценарные ориентиры';
      content.append(heading);
      brief.scenarios.forEach(item => {
        const row = document.createElement('div');
        row.className = 'ac-valuation-row';
        const name = document.createElement('span');
        name.textContent = item.label + ' (' + (item.changePct > 0 ? '+' : '') + item.changePct + '%)';
        const result = document.createElement('strong');
        result.textContent = format(item.value);
        row.append(name, result);
        content.append(row);
      });
    }
    panel.hidden = false;
    status.textContent = 'Сводка передана вручную и хранится только в текущей вкладке. Срок действия — до 2 часов.';
    clear.addEventListener('click', function () {
      clearBrief(root.sessionStorage);
      panel.hidden = true;
    });
  }

  const api = { STORAGE_KEY, MAX_AGE_MS, buildBrief, saveBrief, readBrief, clearBrief };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinValuationHandoff = Object.assign(root.ZhakinValuationHandoff || {}, api);
  if (root && root.document) {
    const start = function () {
      initCalculator(root.document);
      initAnalytical(root.document);
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
