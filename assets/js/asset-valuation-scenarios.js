(function (root) {
  'use strict';

  const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];
  const PAIRS = { USD: 'RUB/USD', EUR: 'RUB/EUR', CNY: 'RUB/CNY' };

  function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(label + ': укажите число больше нуля.');
    return number;
  }

  function calculateScenarioSet(input) {
    const baseValue = finite(input.baseValue, 'Базовая стоимость');
    const currency = String(input.currency || '');
    const date = String(input.assessmentDate || '');
    if (!CURRENCIES.includes(currency)) throw new Error('Выберите поддерживаемую валюту.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))) {
      throw new Error('Укажите корректную дату оценки.');
    }
    const optimisticPct = Number(input.optimisticPct);
    const stressPct = Number(input.stressPct);
    if (!Number.isFinite(optimisticPct) || optimisticPct < 0 || optimisticPct > 500) {
      throw new Error('Оптимистичное отклонение должно быть от 0 до 500%.');
    }
    if (!Number.isFinite(stressPct) || stressPct > 0 || stressPct < -100) {
      throw new Error('Стрессовое отклонение должно быть от −100 до 0%.');
    }
    const scenarios = [
      { key: 'stress', label: 'Стрессовый', changePct: stressPct },
      { key: 'base', label: 'Базовый', changePct: 0 },
      { key: 'optimistic', label: 'Оптимистичный', changePct: optimisticPct }
    ].map(item => ({ ...item, value: baseValue * (1 + item.changePct / 100) }));
    const sensitivity = [-20, -10, 0, 10, 20].map(changePct => ({
      changePct,
      value: baseValue * (1 + changePct / 100)
    }));
    return { baseValue, currency, assessmentDate: date, scenarios, sensitivity };
  }

  function findOfficialRateOnDate(snapshot, currency, assessmentDate) {
    if (!snapshot || !Array.isArray(snapshot.observations) || !PAIRS[currency]) return null;
    const pair = PAIRS[currency];
    const valid = snapshot.observations.filter(row =>
      row && row.indicator_id === 'macro.fx_official' &&
      row.series_key === pair && row.unit === 'RUB_per_1_' + currency &&
      row.validation_status === 'validated' &&
      row.reference_period === assessmentDate &&
      Number.isFinite(Number(row.value)) && Number(row.value) > 0 &&
      row.source && row.source.name === 'Bank of Russia' &&
      typeof row.source.url === 'string' && row.source.url.startsWith('https://www.cbr.ru/')
    );
    if (!valid.length) return null;
    valid.sort((a, b) => String(b.retrieved_at || '').localeCompare(String(a.retrieved_at || '')));
    return { value: Number(valid[0].value), date: assessmentDate, source: valid[0].source };
  }

  function convertToRub(value, currency, snapshot, assessmentDate) {
    if (currency === 'RUB') return { value, rate: 1, rateDate: assessmentDate, converted: true };
    const rate = findOfficialRateOnDate(snapshot, currency, assessmentDate);
    if (!rate) return { value: null, rate: null, rateDate: null, converted: false };
    return { value: value * rate.value, rate: rate.value, rateDate: rate.date, source: rate.source, converted: true };
  }

  const api = { calculateScenarioSet, findOfficialRateOnDate, convertToRub };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinValuationScenarios = api;
})(typeof window !== 'undefined' ? window : globalThis);
