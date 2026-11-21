(function (root) {
  'use strict';

  const SUPPORTED = ['RUB', 'USD', 'EUR', 'CNY'];

  function isDate(value) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  // This adapter exposes provenance only. It deliberately accepts no valuation
  // amount and never mutates calculator inputs or produces a converted value.
  function resolveReference(snapshot, currency, assessmentDate, scenarioApi) {
    const code = String(currency || '');
    const date = String(assessmentDate || '');

    if (!SUPPORTED.includes(code)) {
      return { status: 'unsupported_currency', currency: code, assessmentDate: date, applied: false };
    }
    if (!isDate(date)) {
      return { status: 'invalid_assessment_date', currency: code, assessmentDate: date, applied: false };
    }
    if (code === 'RUB') {
      return {
        status: 'not_required',
        currency: code,
        assessmentDate: date,
        applied: false,
        message: 'Оценка уже выражена в рублях; валютная конвертация не требуется.'
      };
    }

    const api = scenarioApi || (root && root.ZhakinValuationScenarios);
    if (!api || typeof api.findOfficialRateOnDate !== 'function') {
      return { status: 'reference_unavailable', currency: code, assessmentDate: date, applied: false };
    }

    let rate = null;
    try {
      rate = api.findOfficialRateOnDate(snapshot, code, date);
    } catch (_) {
      rate = null;
    }

    if (!rate || !Number.isFinite(Number(rate.value)) || Number(rate.value) <= 0 ||
        rate.date !== date || !rate.source || rate.source.name !== 'Bank of Russia' ||
        typeof rate.source.url !== 'string' || !rate.source.url.startsWith('https://www.cbr.ru/')) {
      return { status: 'reference_unavailable', currency: code, assessmentDate: date, applied: false };
    }

    return {
      status: 'validated_reference_available',
      currency: code,
      assessmentDate: date,
      rate: Number(rate.value),
      rateDate: date,
      sourceName: rate.source.name,
      sourceUrl: rate.source.url,
      applied: false,
      message: 'Курс доступен как справочный ориентир и не применяется к расчёту автоматически.'
    };
  }

  const api = { resolveReference, isDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinValuationMonitoringBridge = api;
})(typeof window !== 'undefined' ? window : globalThis);
