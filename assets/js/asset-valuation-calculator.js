(function (root) {
  'use strict';

  function number(value, label, options = {}) {
    if (value === '' || value === null || value === undefined) throw new Error(label + ': заполните поле.');
    const n = Number(value);
    if (!Number.isFinite(n) || (options.positive ? n <= 0 : n < 0)) {
      throw new Error(label + (options.positive ? ': укажите значение больше нуля.' : ': укажите неотрицательное число.'));
    }
    return n;
  }

  function calculateBusiness(input) {
    const ebitda = number(input.ebitda, 'EBITDA', { positive: true });
    const multiple = number(input.multiple, 'Мультипликатор', { positive: true });
    const debt = number(input.debt || 0, 'Долг');
    const cash = number(input.cash || 0, 'Денежные средства');
    const enterpriseValue = ebitda * multiple;
    const equityValue = enterpriseValue - debt + cash;
    return {
      method: 'Доходно-рыночный ориентир (EBITDA × мультипликатор)',
      enterpriseValue,
      equityValue,
      low: equityValue * 0.9,
      high: equityValue * 1.1,
      assumptions: 'Диапазон ±10% — техническая чувствительность к выбранному мультипликатору, а не рыночный доверительный интервал.'
    };
  }

  function calculateProperty(input) {
    const area = number(input.area, 'Площадь', { positive: true });
    const price = number(input.pricePerSqm, 'Цена за м²', { positive: true });
    const marketValue = area * price;
    const result = {
      method: 'Сравнительный подход (площадь × цена за м²)',
      marketValue,
      low: marketValue * 0.95,
      high: marketValue * 1.05,
      assumptions: 'Диапазон ±5% — условная чувствительность к исходной цене за м²; качество аналогов отдельно не проверяется.'
    };
    const noiPresent = input.noi !== '' && input.noi !== null && input.noi !== undefined;
    const capPresent = input.capRate !== '' && input.capRate !== null && input.capRate !== undefined;
    if (noiPresent || capPresent) {
      if (!noiPresent || !capPresent) throw new Error('Для доходного подхода заполните и NOI, и ставку капитализации.');
      const noi = number(input.noi, 'Годовой чистый операционный доход', { positive: true });
      const capRate = number(input.capRate, 'Ставка капитализации', { positive: true });
      if (capRate > 100) throw new Error('Ставка капитализации не может превышать 100%.');
      result.incomeValue = noi / (capRate / 100);
      result.incomeMethod = 'Доходный подход (годовой NOI ÷ ставка капитализации)';
    }
    return result;
  }

  function calculateEquipment(input) {
    const replacementCost = number(input.replacementCost, 'Стоимость нового аналога', { positive: true });
    const depreciation = number(input.depreciation, 'Совокупный износ');
    if (depreciation > 100) throw new Error('Совокупный износ должен быть от 0 до 100%.');
    const value = replacementCost * (1 - depreciation / 100);
    return {
      method: 'Затратный подход (стоимость замещения с учётом износа)',
      value,
      low: value * 0.9,
      high: value * 1.1,
      assumptions: 'Износ введён пользователем совокупно; диапазон ±10% — условная чувствительность, не техническая экспертиза.'
    };
  }

  const api = { calculateBusiness, calculateProperty, calculateEquipment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZhakinValuation = api;
})(typeof window !== 'undefined' ? window : globalThis);
