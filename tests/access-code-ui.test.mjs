import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/html/app.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="access-code-text"'), 'app page must have access code text');
assert.ok(html.includes('id="copy-access-code"'), 'app page must have copy access code button');

const actions = fs.readFileSync(new URL('../public/js/modules/app/mailbox-actions.js', import.meta.url), 'utf8');
assert.ok(actions.includes('setAccessCode'), 'mailbox actions must set access code');
assert.ok(actions.includes('access_code'), 'mailbox actions must read access_code');

const list = fs.readFileSync(new URL('../public/js/modules/app/mailbox-list.js', import.meta.url), 'utf8');
assert.ok(list.includes('access_code'), 'mailbox list must render access code');
assert.ok(list.includes('copyAccessCode'), 'mailbox list code must be copyable');

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(app.includes('window.copyAccessCode'), 'app.js must expose copyAccessCode');

assert.ok(app.includes('copyText'), 'copy must use the shared copyText fallback');
assert.ok(actions.includes("setAccessCode(elements, '')"), 'access code must be cleared on selection/delete transitions');

console.log('access-code-ui: all assertions passed');
