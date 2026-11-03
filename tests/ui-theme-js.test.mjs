import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/js/theme.js', import.meta.url), 'utf8');

const storage = new Map();
const attributes = {};
const documentElement = {
  setAttribute: (key, value) => { attributes[key] = value; },
  getAttribute: (key) => attributes[key] || null
};
const mockWindow = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {}
};
const mockDocument = {
  documentElement,
  readyState: 'complete',
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => []
  }),
  body: { appendChild: () => {} }
};
const mockLocalStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, value)
};

const factory = new Function('window', 'document', 'localStorage', source);
factory(mockWindow, mockDocument, mockLocalStorage);

const api = mockWindow.FreemailTheme;
assert.ok(api, 'theme.js must expose window.FreemailTheme');
assert.deepEqual(api.get(), { style: 'calm', mode: 'light' }, 'defaults must be calm + light');

api.set('warm', 'dark');
assert.equal(attributes['data-style'], 'warm');
assert.equal(attributes['data-mode'], 'dark');
assert.equal(api.get().style, 'warm');
assert.equal(api.get().mode, 'dark');
assert.ok(storage.get('mf:ui-theme').includes('warm'), 'preference must be persisted');

api.set('bogus', 'neon');
assert.equal(api.get().style, 'warm', 'invalid style must be ignored');
assert.equal(api.get().mode, 'dark', 'invalid mode must be ignored');

assert.ok(source.includes('mf:ui-theme'), 'storage key must be mf:ui-theme');
assert.ok(source.includes("'tech'"), 'tech style must be supported');
assert.ok(!source.includes('_black.css'), 'theme.js must not reference legacy _black.css');

console.log('ui-theme-js: all assertions passed');
