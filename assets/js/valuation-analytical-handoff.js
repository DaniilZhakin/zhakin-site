(function (root) {
  'use strict';

  const STORAGE_KEY = 'zhakin_valuation_analytical_handoff_v1';
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const KINDS = ['business', 'property', 'equipment'];
  const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function buildBrief(input, now) {
    if (!input || !KINDS.includes(input.kind)) throw new Error('Неизвестный тип актива.');
    const value = finiteOrNull(input.value);
    if (value === null || value <= 0) throw new Error('Нет корректного результата оценки.');
    const currency = String(input.currency || '');
    if (!CURRENCIES.includes(currency)) throw new Error('Неподдерживаемая валюта.');
    const assessmentDate = String(input.assessmentDate || '');
    const parsedDate = new Date(assessmentDate + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== assessmentDate) throw new Error('Укажите корректную дату оценки.');
    const createdAt = new Date(now === undefined ? Date.now() : now).toISOString();
    const low = finiteOrNull(input.low);
    const high = finiteOrNull(input.high);
    const stressPct = Number(input.stressPct);
    const optimisticPct = Number(input.optimisticPct);
    const scenarios = Number.isFinite(stressPct) && Number.isFinite(optimisticPct) &&
      stressPct >= -100 && stressPct <= 0 && optimisticPct >= 0 && optimisticPct <= 500
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
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      clearBrief(storage);
      return null;
    }
    const current = now === undefined ? Date.now() : Number(now);
    const assessmentDate = typeof brief.assessmentDate === 'string' ? brief.assessmentDate : '';
    const parsedAssessmentDate = new Date(assessmentDate + 'T00:00:00Z');
    const validAssessmentDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(assessmentDate) &&
      Number.isFinite(parsedAssessmentDate.getTime()) &&
      parsedAssessmentDate.toISOString().slice(0, 10) === assessmentDate;
    const created = Date.parse(brief.createdAt || '');
    const expires = Date.parse(brief.expiresAt || '');
    const value = Number(brief.value);
    const low = brief.low === null ? null : Number(brief.low);
    const high = brief.high === null ? null : Number(brief.high);
    const validScenarios = Array.isArray(brief.scenarios) && brief.scenarios.length <= 3 &&
      brief.scenarios.every(item => item && typeof item.label === 'string' &&
        Number.isFinite(Number(item.changePct)) && Number.isFinite(Number(item.value)) &&
        Number(item.changePct) >= -100 && Number(item.changePct) <= 500 && Number(item.value) >= 0);
    if (brief.schemaVersion !== 1 || !Number.isFinite(created) || !Number.isFinite(expires) ||
        expires <= current || expires <= created || expires - created > MAX_AGE_MS ||
        created > current || !KINDS.includes(brief.kind) || !CURRENCIES.includes(brief.currency) ||
        !Number.isFinite(value) || value <= 0 ||
        (low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high)) ||
        !validScenarios || typeof brief.method !== 'string' || brief.method.length > 180 ||
        typeof brief.assessmentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(brief.assessmentDate)) {
      clearBrief(storage);
      return null;
    }
    return brief;
  }

  function clearBrief(storage) {
    try { storage.removeItem(STORAGE_KEY); } catch (_) {}
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
        : 'Параметры изменены. Повторите расчёт сценариев.';
    };
    ['scenario-date', 'scenario-stress', 'scenario-optimistic'].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.addEventListener('input', () => root.ZhakinValuationHandoff.setLatest(null));
    });
  }

  function initAnalytical(document) {
    const panel = document.getElementById('valuation-brief');
    if (!panel) return;
    const content = panel.querySelector('[data-valuation-brief-content]');
    const clear = panel.querySelector('[data-clear-valuation-brief]');
    const status = panel.querySelector('[data-valuation-brief-status]');
    let brief = null;
    try { brief = readBrief(root.sessionStorage); } catch (_) { brief = null; }
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
      try { clearBrief(root.sessionStorage); } catch (_) {}
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
