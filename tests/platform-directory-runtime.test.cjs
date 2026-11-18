const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor({ textContent = '', dataset = {}, value = '' } = {}) {
    this.textContent = textContent;
    this.dataset = dataset;
    this.value = value;
    this.hidden = false;
    this.attributes = {};
    this.listeners = {};
    this.classNames = new Set();
    this.classList = {
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classNames.has(name) : force;
        if (enabled) this.classNames.add(name);
        else this.classNames.delete(name);
        return enabled;
      },
      contains: name => this.classNames.has(name)
    };
  }
  addEventListener(type, callback) {
    (this.listeners[type] ||= []).push(callback);
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  dispatch(type) {
    for (const callback of this.listeners[type] || []) callback({ target: this });
  }
}

function createHarness() {
  const cards = [
    new FakeElement({ textContent: 'Международное сотрудничество', dataset: { kind: 'direction', search: 'экспорт рынки' } }),
    new FakeElement({ textContent: 'Аналитика и знания', dataset: { kind: 'knowledge', search: 'публикации экономика' } }),
    new FakeElement({ textContent: 'ZHAKIN Wallet', dataset: { kind: 'service', search: 'кошелёк бонусы' } })
  ];
  const grid = new FakeElement();
  grid.querySelectorAll = selector => selector === '.platform-card' ? cards : [];
  const search = new FakeElement();
  const count = new FakeElement();
  const empty = new FakeElement();
  const filters = ['all', 'direction', 'knowledge', 'service'].map(filter => {
    const button = new FakeElement({ dataset: { filter } });
    button.classList.toggle('is-active', filter === 'all');
    return button;
  });
  const nodes = {
    '#platform-grid': grid,
    '#platform-search': search,
    '#platform-count': count,
    '#platform-empty': empty
  };
  let ready;
  const document = {
    addEventListener: (event, callback) => {
      if (event === 'DOMContentLoaded') ready = callback;
    },
    querySelector: selector => nodes[selector] || null,
    querySelectorAll: selector => selector === '[data-filter]' ? filters : []
  };
  const source = fs.readFileSync('assets/js/platform-directory.js', 'utf8');
  vm.runInNewContext(source, { document });
  ready();
  return { cards, search, count, empty, filters };
}

test('directory initializes with all cards visible and an accurate count', () => {
  const { cards, count, empty } = createHarness();
  assert.equal(cards.filter(card => !card.hidden).length, 3);
  assert.equal(count.textContent, 'Показано 3 из 3 разделов');
  assert.equal(empty.hidden, true);
});

test('search filters cards by visible text and search keywords', () => {
  const { cards, search, count, empty } = createHarness();
  search.value = 'кошелёк';
  search.dispatch('input');
  assert.deepEqual(cards.map(card => card.hidden), [true, true, false]);
  assert.equal(count.textContent, 'Показано 1 из 3 разделов');
  assert.equal(empty.hidden, true);
});

test('category filter updates aria-pressed state and visible result count', () => {
  const { cards, filters, count } = createHarness();
  const knowledge = filters.find(button => button.dataset.filter === 'knowledge');
  knowledge.dispatch('click');
  assert.deepEqual(cards.map(card => card.hidden), [true, false, true]);
  assert.equal(count.textContent, 'Показано 1 из 3 разделов');
  assert.equal(knowledge.attributes['aria-pressed'], 'true');
  assert.equal(filters.find(button => button.dataset.filter === 'all').attributes['aria-pressed'], 'false');
});

test('empty state is announced when search and category have no matches', () => {
  const { search, count, empty } = createHarness();
  search.value = 'несуществующий раздел';
  search.dispatch('input');
  assert.equal(count.textContent, 'Показано 0 из 3 разделов');
  assert.equal(empty.hidden, false);
});
