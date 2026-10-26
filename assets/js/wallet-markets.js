(() => {
  "use strict";
  const root = document.querySelector("[data-market-board]");
  if (!root) return;

  const $ = (selector) => root.querySelector(selector);
  const status = $("[data-market-status]");
  const refreshed = $("[data-market-updated]");
  const currencySelect = $("[data-market-currency]");
  const cryptoBody = $("[data-market-crypto]");
  const fxBody = $("[data-market-fx]");
  const refreshButton = $("[data-market-refresh]");
  const state = { currency: "USD", quotes: [], fx: [], lastSuccess: null };
  const symbols = [
    { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin" },
    { symbol: "ETHUSDT", base: "ETH", name: "Ethereum" },
    { symbol: "BNBUSDT", base: "BNB", name: "BNB" },
    { symbol: "SOLUSDT", base: "SOL", name: "Solana" },
    { symbol: "XRPUSDT", base: "XRP", name: "XRP" }
  ];
  const currencyNames = { USD: "доллар США", EUR: "евро", RUB: "российский рубль" };
  const fmt = (value, digits = 2) => new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0, maximumFractionDigits: digits
  }).format(value);
  const dateFmt = (value) => new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium", timeStyle: "short"
  }).format(value);
  const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const text = (tag, value, className) => {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  async function getJson(url, timeout = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Источник вернул ошибку");
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function getText(url, timeout = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Источник вернул ошибку");
      return await response.text();
    } finally { clearTimeout(timer); }
  }
  function parseCbr(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Не удалось прочитать данные ЦБ РФ");
    const result = [];
    doc.querySelectorAll("Valute").forEach((node) => {
      const code = node.querySelector("CharCode")?.textContent?.trim();
      const nominal = safeNumber(node.querySelector("Nominal")?.textContent?.replace(",", "."));
      const value = safeNumber(node.querySelector("Value")?.textContent?.replace(",", "."));
      if (code && nominal && value) result.push({ code, value: value / nominal });
    });
    if (!result.length) throw new Error("В ответе ЦБ РФ нет курсов");
    return result;
  }
  function parseEcb(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Не удалось прочитать данные ЕЦБ");
    const result = [{ code: "EUR", value: 1 }];
    doc.querySelectorAll("Cube[currency][rate]").forEach((node) => {
      const code = node.getAttribute("currency");
      const value = safeNumber(node.getAttribute("rate"));
      if (code && value) result.push({ code, value });
    });
    if (result.length < 2) throw new Error("В ответе ЕЦБ нет курсов");
    return result;
  }
  async function loadCrypto() {
    const sources = [
      {
        name: "Binance",
        url: "https://api.binance.com/api/v3/ticker/24hr",
        parse: (data) => {
          const rows = Array.isArray(data) ? data : [data];
          return symbols.map((s) => {
            const q = rows.find((item) => item.symbol === s.symbol);
            return q ? { ...s, source: "Binance", price: safeNumber(q.lastPrice), change: safeNumber(q.priceChangePercent) } : null;
          }).filter(Boolean);
        }
      },
      {
        name: "OKX",
        url: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
        parse: (data) => symbols.map((s) => {
          const q = data?.data?.find((item) => item.instId === s.base + "-USDT");
          const open = safeNumber(q?.open24h);
          const last = safeNumber(q?.last);
          return q && last !== null && open ? { ...s, source: "OKX", price: last, change: ((last - open) / open) * 100 } : null;
        }).filter(Boolean)
      },
      {
        name: "Bybit",
        url: "https://api.bybit.com/v5/market/tickers?category=spot",
        parse: (data) => symbols.map((s) => {
          const q = data?.result?.list?.find((item) => item.symbol === s.symbol);
          return q ? { ...s, source: "Bybit", price: safeNumber(q.lastPrice), change: safeNumber(q.price24hPcnt) * 100 } : null;
        }).filter(Boolean)
      }
    ];
    const settled = await Promise.allSettled(sources.map(async (source) => {
      const data = await getJson(source.url);
      return source.parse(data);
    }));
    const results = [];
    settled.forEach((item) => {
      if (item.status === "fulfilled") results.push(...item.value);
    });
    if (!results.length) throw new Error("Биржи пока не ответили. Проверьте соединение и повторите обновление.");
    return results;
  }
  async function loadFx() {
    const settled = await Promise.allSettled([
      getText("https://www.cbr.ru/scripts/XML_daily.asp").then((xml) => ({ source: "Банк России", rows: parseCbr(xml) })),
      getText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml").then((xml) => ({ source: "ЕЦБ", rows: parseEcb(xml) }))
    ]);
    const result = [];
    settled.forEach((item) => {
      if (item.status === "fulfilled") result.push(item.value);
    });
    if (!result.length) throw new Error("Официальные валютные источники не ответили. Курсы не подменяются расчётными значениями.");
    return result;
  }
  function renderCrypto() {
    cryptoBody.replaceChildren();
    const rows = state.quotes.filter((q) => q.price !== null && Number.isFinite(q.price));
    if (!rows.length) {
      cryptoBody.append(text("tr", "", "market-empty-row"));
      const cell = text("td", "Котировки временно недоступны");
      cell.colSpan = 4;
      cryptoBody.firstChild.append(cell);
      return;
    }
    rows.forEach((q) => {
      const row = document.createElement("tr");
      const asset = document.createElement("td");
      asset.append(text("strong", q.base), text("small", q.name));
      const price = q.price * (state.currency === "USD" ? 1 : state.currency === "EUR" ? (state.usdToEur || 1) : (state.usdToRub || 1));
      row.append(asset, text("td", fmt(price, price < 1 ? 6 : 2) + " " + state.currency));
      const change = q.change;
      const changeCell = text("td", change === null ? "—" : (change > 0 ? "+" : "") + fmt(change, 2) + "%", change > 0 ? "market-positive" : change < 0 ? "market-negative" : "");
      row.append(changeCell, text("td", q.source, "market-source"));
      cryptoBody.append(row);
    });
  }
  function renderFx() {
    fxBody.replaceChildren();
    const unique = new Map();
    state.fx.forEach((group) => group.rows.forEach((rate) => {
      const key = group.source + ":" + rate.code;
      if (!unique.has(key)) unique.set(key, { ...rate, source: group.source });
    }));
    const rows = [...unique.values()].filter((r) => ["USD", "EUR", "GBP", "CNY", "RUB", "JPY", "CHF", "KZT", "TRY"].includes(r.code));
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = text("td", "Валютные данные временно недоступны");
      cell.colSpan = 3;
      row.append(cell); fxBody.append(row); return;
    }
    rows.slice(0, 18).forEach((r) => {
      const row = document.createElement("tr");
      row.append(text("td", r.code), text("td", fmt(r.value, 4)), text("td", r.source, "market-source"));
      fxBody.append(row);
    });
  }
  function renderStatus(message, mode = "info") {
    status.textContent = message;
    status.dataset.state = mode;
  }
  async function refresh() {
    refreshButton.disabled = true;
    refreshButton.textContent = "Обновляем…";
    renderStatus("Запрашиваем публичные котировки и официальные валютные курсы…");
    const outcomes = await Promise.allSettled([loadCrypto(), loadFx()]);
    let good = 0;
    if (outcomes[0].status === "fulfilled") { state.quotes = outcomes[0].value; good++; }
    if (outcomes[1].status === "fulfilled") { state.fx = outcomes[1].value; good++; }
    const cbr = state.fx.find((group) => group.source === "Банк России");
    const ecb = state.fx.find((group) => group.source === "ЕЦБ");
    const usdRub = cbr?.rows.find((r) => r.code === "USD")?.value;
    const eurUsd = ecb?.rows.find((r) => r.code === "USD")?.value;
    state.usdToRub = usdRub || null;
    state.usdToEur = eurUsd ? 1 / eurUsd : null;
    if (outcomes[0].status === "fulfilled" && outcomes[1].status === "rejected") {
      renderStatus("Криптокотировки получены; валютные курсы сейчас недоступны. Возможна блокировка запроса браузером.", "partial");
    } else if (outcomes[0].status === "rejected" && outcomes[1].status === "fulfilled") {
      renderStatus("Валютные курсы получены; биржи сейчас недоступны. Возможна блокировка запроса браузером.", "partial");
    } else if (good === 2) {
      state.lastSuccess = new Date();
      renderStatus("Данные получены из публичных источников. Котировки не являются торговым предложением.", "success");
    } else {
      renderStatus("Не удалось получить данные. Значения не выдумываются; повторите попытку позже.", "error");
    }
    renderCrypto();
    renderFx();
    refreshed.textContent = state.lastSuccess ? "Последнее успешное обновление: " + dateFmt(state.lastSuccess) : "Время успешного обновления пока отсутствует";
    refreshButton.disabled = false;
    refreshButton.textContent = "Обновить данные";
  }
  currencySelect.addEventListener("change", () => {
    state.currency = currencySelect.value;
    renderCrypto();
  });
  refreshButton.addEventListener("click", refresh);
  renderStatus("Публичные данные загружаются при открытии страницы.");
  refresh();
})();