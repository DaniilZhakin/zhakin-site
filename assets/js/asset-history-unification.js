(function (root) {
  'use strict';

  const REGISTRY_KEY = 'zhakin.assetValuation.registry.v1';
  const DASHBOARD_KEY = 'zhakin_analytical_asset_history_v1';
  const MAX_RECORDS = 200;
  const KINDS = ['business', 'property', 'equipment', 'other'];
  const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function normalize(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const kind = String(record.kind || record.type || '');
    const currency = String(record.currency || '');
    const assessmentDate = String(record.assessmentDate || record.date || '');
    const value = Number(record.value);
    const createdAt = String(record.createdAt || '');
    const name = String(record.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const method = String(record.method || 'Метод не указан').trim().slice(0, 160);
    if (typeof record.id !== 'string' || !record.id || record.id.length > 100 ||
        !name || !KINDS.includes(kind) || !CURRENCIES.includes(currency) ||
        !validDate(assessmentDate) || !Number.isFinite(value) || value <= 0 || value > 1e15 ||
        !Number.isFinite(Date.parse(createdAt))) return null;
    const low = record.low === null || record.low === undefined || record.low === '' ? null : Number(record.low);
    const high = record.high === null || record.high === undefined || record.high === '' ? null : Number(record.high);
    if ((low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high)) ||
        (low !== null && high !== null && low > high)) return null;
    return {
      id: record.id,
      name,
      kind,
      method,
      value,
      low,
      high,
      currency,
      assessmentDate,
      createdAt: new Date(createdAt).toISOString()
    };
  }

  function parseRegistry(raw) {
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return []; }
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records.map(normalize).filter(Boolean);
  }

  function parseDashboard(raw) {
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter(Boolean);
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('Локальное хранилище недоступно.');
    let registryRaw, dashboardRaw;
    try { registryRaw = storage.getItem(REGISTRY_KEY); dashboardRaw = storage.getItem(DASHBOARD_KEY); }
    catch (_) { throw new Error('Локальное хранилище недоступно.'); }
    const registry = parseRegistry(registryRaw);
    const dashboard = parseDashboard(dashboardRaw);
    const byId = new Map();
    [...registry, ...dashboard].forEach(row => {
      const previous = byId.get(row.id);
      if (!previous || row.createdAt > previous.createdAt) byId.set(row.id, row);
    });
    const rows = [...byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.assessmentDate.localeCompare(a.assessmentDate));
    // Never silently discard legacy assessments. Keep oversized histories readable,
    // and do not rewrite either legacy key until the history is within the limit.
    // Strip unexpected or malformed fields from parseable legacy stores before returning them.
    let rewrite = false;
    try {
      if (registryRaw) {
        const parsed = JSON.parse(registryRaw);
        if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.records)) {
          rewrite = JSON.stringify(parsed.records) !== JSON.stringify(parseRegistry(registryRaw).map(toRegistry));
        }
      }
      if (dashboardRaw) {
        const parsed = JSON.parse(dashboardRaw);
        if (Array.isArray(parsed)) rewrite = rewrite || JSON.stringify(parsed) !== JSON.stringify(parseDashboard(dashboardRaw).map(toDashboard));
      }
    } catch (_) { /* Leave unparseable legacy bytes untouched for recovery. */ }
    if (rewrite && rows.length <= MAX_RECORDS) { try { write(storage, rows); } catch (_) { /* Keep validated in-memory rows readable when storage is read-only. */ } }
    return rows;
  }

  function toRegistry(row) {
    return {
      id: row.id, name: row.name, kind: row.kind, method: row.method,
      value: row.value, low: row.low, high: row.high, currency: row.currency,
      assessmentDate: row.assessmentDate, createdAt: row.createdAt
    };
  }

  function toDashboard(row) {
    return {
      id: row.id, name: row.name, type: row.kind, date: row.assessmentDate,
      value: row.value, currency: row.currency, method: row.method.slice(0, 120),
      createdAt: row.createdAt
    };
  }

  function write(storage, records) {
    if (!storage || typeof storage.getItem !== 'function' ||
        typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new Error('Локальное хранилище недоступно.');
    }
    const rows = (Array.isArray(records) ? records : []).map(normalize).filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (rows.length > MAX_RECORDS) {
      throw new Error('История содержит более 200 оценок. Удалите ненужные записи перед добавлением новых; существующие данные сохранены.');
    }
    const registryValue = JSON.stringify({ schemaVersion: 1, records: rows.map(toRegistry) });
    const dashboardValue = JSON.stringify(rows.map(toDashboard));
    const previousRegistry = storage.getItem(REGISTRY_KEY);
    const previousDashboard = storage.getItem(DASHBOARD_KEY);
    try {
      storage.setItem(REGISTRY_KEY, registryValue);
      storage.setItem(DASHBOARD_KEY, dashboardValue);
    } catch (error) {
      try {
        if (previousRegistry === null) storage.removeItem(REGISTRY_KEY);
        else storage.setItem(REGISTRY_KEY, previousRegistry);
        if (previousDashboard === null) storage.removeItem(DASHBOARD_KEY);
        else storage.setItem(DASHBOARD_KEY, previousDashboard);
      } catch (_) {
        throw new Error('Не удалось сохранить единую историю и восстановить прежние локальные данные.');
      }
      throw new Error('Не удалось сохранить единую историю: браузер отклонил запись.');
    }
    return rows;
  }

  function save(storage, record) {
    const row = normalize(record);
    if (!row) throw new Error('Некорректная запись оценки.');
    const rows = read(storage).filter(item => item.id !== row.id);
    rows.unshift(row);
    write(storage, rows);
    return row;
  }

  function remove(storage, id) {
    const remaining = read(storage).filter(row => row.id !== String(id));
    // A deliberate deletion may need to persist a still-oversized legacy history.
    if (remaining.length <= MAX_RECORDS) return write(storage, remaining);
    return writeOversizedForRemoval(storage, remaining);
  }

  function writeOversizedForRemoval(storage, records) {
    const rows = records.map(normalize).filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const registryValue = JSON.stringify({ schemaVersion: 1, records: rows.map(toRegistry) });
    const dashboardValue = JSON.stringify(rows.map(toDashboard));
    const previousRegistry = storage.getItem(REGISTRY_KEY);
    const previousDashboard = storage.getItem(DASHBOARD_KEY);
    try {
      storage.setItem(REGISTRY_KEY, registryValue);
      storage.setItem(DASHBOARD_KEY, dashboardValue);
    } catch (_) {
      try {
        if (previousRegistry === null) storage.removeItem(REGISTRY_KEY);
        else storage.setItem(REGISTRY_KEY, previousRegistry);
        if (previousDashboard === null) storage.removeItem(DASHBOARD_KEY);
        else storage.setItem(DASHBOARD_KEY, previousDashboard);
      } catch (_) {
        throw new Error('Не удалось сохранить удаление и восстановить прежние локальные данные.');
      }
      throw new Error('Не удалось удалить запись: браузер отклонил запись.');
    }
    return rows;
  }

  function clear(storage) {
    if (!storage || typeof storage.removeItem !== 'function') throw new Error('Локальное хранилище недоступно.');
    const previousRegistry = storage.getItem(REGISTRY_KEY);
    const previousDashboard = storage.getItem(DASHBOARD_KEY);
    try {
      storage.removeItem(REGISTRY_KEY);
      storage.removeItem(DASHBOARD_KEY);
    } catch (_) {
      try {
        if (previousRegistry !== null) storage.setItem(REGISTRY_KEY, previousRegistry);
        if (previousDashboard !== null) storage.setItem(DASHBOARD_KEY, previousDashboard);
      } catch (_) {}
      throw new Error('Не удалось очистить единую историю.');
    }
  }

  const api = { REGISTRY_KEY, DASHBOARD_KEY, MAX_RECORDS, normalize, read, write, save, remove, clear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinAssetHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
