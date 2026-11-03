import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/theme-preview.html', import.meta.url), 'utf8');

for (const asset of ['/css/tokens.css', '/css/components.css', '/css/theme-switcher.css', '/js/theme.js']) {
  assert.ok(html.includes(asset), `preview page must load ${asset}`);
}

for (const demo of ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'input', 'card', 'badge-success', 'modal-card', 'toast-item']) {
  assert.ok(html.includes(demo), `preview page must demo ${demo}`);
}

assert.ok(html.includes('data-style'), 'preview must include no-FOUC theme bootstrap');
assert.ok(html.includes('mf:ui-theme'), 'preview bootstrap must read mf:ui-theme');
assert.ok(!html.includes('_black.css'), 'preview must not use legacy _black.css');
assert.ok(!html.includes('fonts.googleapis.com'), 'preview must not load external fonts');

console.log('ui-preview-page: all assertions passed');
