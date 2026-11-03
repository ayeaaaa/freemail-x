import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/components.css', import.meta.url), 'utf8');

const requiredSelectors = [
  '.btn', '.btn-primary', '.btn-secondary', '.btn-ghost', '.btn-danger', '.btn-sm',
  '.input', '.select', '.card', '.badge', '.badge-success', '.badge-danger',
  '.modal-overlay', '.modal-card', '.toast', '.topbar'
];
for (const selector of requiredSelectors) {
  assert.ok(css.includes(selector), `components.css must define ${selector}`);
}

const tokenUsage = (css.match(/var\(--[a-z0-9-]+\)/g) || []).length;
assert.ok(tokenUsage >= 60, `components.css must use design tokens (found ${tokenUsage})`);

const hardcodedColors = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
assert.equal(hardcodedColors.length, 0, `components.css must not hardcode colors: ${hardcodedColors.join(', ')}`);

console.log('ui-components: all assertions passed');
