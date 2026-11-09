const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeClassList() {
  const values = new Set();
  return {
    contains(name) {
      return values.has(name);
    },
    toggle(name, force) {
      const shouldAdd = typeof force === "boolean" ? force : !values.has(name);
      if (shouldAdd) values.add(name);
      else values.delete(name);
      return shouldAdd;
    }
  };
}

function makeElement() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    listeners,
    attributes,
    classList: makeClassList(),
    focusCount: 0,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    focus() {
      this.focusCount += 1;
    },
    contains() {
      return false;
    }
  };
}

function loadMainNavigation() {
  const menuButton = makeElement();
  const navigation = makeElement();
  const documentListeners = new Map();
  const readyCallbacks = [];
  const existingWidget = {};

  const document = {
    title: "ZHAKIN test",
    addEventListener(type, handler) {
      if (type === "DOMContentLoaded") readyCallbacks.push(handler);
      else documentListeners.set(type, handler);
    },
    querySelector(selector) {
      if (selector === ".menu-toggle") return menuButton;
      if (selector === ".main-navigation") return navigation;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      // Skip unrelated page widgets so this harness exercises the real
      // navigation controller without emulating the entire website DOM.
      return existingWidget;
    }
  };

  const window = {
    location: {
      pathname: "/",
      href: "https://zhakin.test/"
    }
  };
  const sessionStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets/js/main.js"),
    "utf8"
  );

  vm.runInNewContext(source, { document, window, sessionStorage, URL }, {
    filename: "assets/js/main.js"
  });

  assert.equal(readyCallbacks.length, 1, "main.js should register DOMContentLoaded");
  readyCallbacks[0]();

  return { menuButton, navigation, documentListeners };
}

test("Escape closes the open menu and restores focus to the toggle", () => {
  const { menuButton, navigation, documentListeners } = loadMainNavigation();
  const clickToggle = menuButton.listeners.get("click");
  const onKeyDown = documentListeners.get("keydown");

  assert.equal(typeof clickToggle, "function");
  assert.equal(typeof onKeyDown, "function");

  clickToggle();
  assert.equal(navigation.classList.contains("active"), true);
  assert.equal(menuButton.attributes.get("aria-expanded"), "true");

  let prevented = false;
  onKeyDown({
    key: "Escape",
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(navigation.classList.contains("active"), false);
  assert.equal(menuButton.classList.contains("active"), false);
  assert.equal(menuButton.attributes.get("aria-expanded"), "false");
  assert.equal(menuButton.attributes.get("aria-label"), "Открыть меню");
  assert.equal(menuButton.focusCount, 1);
});

test("Escape does not steal focus when the menu is already closed", () => {
  const { menuButton, navigation, documentListeners } = loadMainNavigation();
  let prevented = false;

  documentListeners.get("keydown")({
    key: "Escape",
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, false);
  assert.equal(navigation.classList.contains("active"), false);
  assert.equal(menuButton.focusCount, 0);
});
