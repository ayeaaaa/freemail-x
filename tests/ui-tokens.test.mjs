import assert from 'node:assert/strict';
import fs from 'node:fs';

const tokens = fs.readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');

const combos = [
  ':root,\n[data-style="calm"][data-mode="light"]',
  '[data-style="calm"][data-mode="dark"]',
  '[data-style="warm"][data-mode="light"]',
  '[data-style="warm"][data-mode="dark"]',
  '[data-style="tech"][data-mode="dark"]',
  '[data-style="tech"][data-mode="light"]'
];
for (const selector of combos) {
  assert.ok(tokens.includes(selector), `tokens.css must define ${selector}`);
}

const requiredTokens = [
  '--bg', '--surface', '--surface-2', '--text', '--text-2', '--text-3',
  '--border', '--border-strong', '--accent', '--accent-hover', '--accent-soft',
  '--accent-contrast', '--danger', '--danger-soft', '--success', '--success-soft',
  '--warning', '--warning-soft', '--radius-sm', '--radius-md', '--radius-lg',
  '--shadow', '--shadow-lg', '--font-sans', '--font-mono', '--overlay',
  '--btn-radius', '--accent-glow', '--focus-ring'
];
for (const token of requiredTokens) {
  const count = (tokens.match(new RegExp(`\\${token}:`, 'g')) || []).length;
  assert.equal(count, 6, `${token} must be defined in all 6 combos (found ${count})`);
}

assert.ok(tokens.includes('color-scheme: dark'), 'dark combos must set color-scheme');
assert.ok(tokens.includes('color-scheme: light'), 'light combos must set color-scheme');

console.log('ui-tokens: all assertions passed');
