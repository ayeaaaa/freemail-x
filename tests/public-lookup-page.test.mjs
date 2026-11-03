import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/lookup.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="access-code-boxes"'), 'lookup page must have access code boxes');
assert.ok(html.includes('id="access-code-input"'), 'lookup page must have the hidden code input');
assert.ok(html.includes('class="code-input"'), 'lookup page must have the overlay input');
assert.ok(html.includes('pattern="[A-Za-z0-9]*"'), 'code input must hint alphanumeric only');
assert.equal((html.match(/class="code-box"/g) || []).length, 8, 'lookup page must have 8 visual boxes');
assert.ok(html.includes('/js/lookup.js'), 'lookup page must load lookup.js');
assert.ok(html.includes('noindex'), 'lookup page must be noindex');

const js = fs.readFileSync(new URL('../public/js/lookup.js', import.meta.url), 'utf8');
assert.ok(js.includes('/api/public/lookup'), 'lookup.js must call public lookup API');
assert.ok(js.includes('/api/public/email/'), 'lookup.js must call public email API');
assert.ok(js.includes('sanitizeHtml'), 'lookup.js must sanitize HTML');
assert.ok(js.includes("import { copyText } from './modules/app/ui-helpers.js'"), 'lookup.js must use the shared copyText helper');
assert.ok(js.includes('sanitizeHtml(email.html_content, { allowStyles: false })'), 'public lookup must disable inline styles');
assert.ok(!js.includes('navigator.clipboard'), 'public lookup must not use navigator.clipboard directly');
assert.ok(js.includes('function getCode()'), 'lookup.js must collect the code');
assert.ok(js.includes('function renderBoxes()'), 'lookup.js must render the visual boxes');
assert.ok(js.includes('function submitCode()'), 'lookup.js must submit the completed code');
assert.ok(js.includes("els.input?.addEventListener('input'"), 'lookup.js must handle typing and paste via the input event');
assert.ok(js.includes("addEventListener('beforeinput'"), 'lookup.js must block non-alphanumeric typing');
assert.ok(js.includes('访问码只支持数字和字母'), 'lookup.js must explain the alphanumeric restriction');
assert.ok(js.includes('code.length === 8'), 'lookup.js must auto-submit when 8 chars are filled');

const sanitize = fs.readFileSync(new URL('../public/js/core/sanitize.js', import.meta.url), 'utf8');
assert.ok(sanitize.includes('export function sanitizeHtml'), 'shared sanitize module must export sanitizeHtml');
assert.ok(sanitize.includes('DANGEROUS_TAGS'), 'sanitizer must distinguish dangerous tags from unknown containers');
assert.ok(sanitize.includes("options.allowStyles !== false"), 'sanitizer must support disabling styles');
assert.ok(sanitize.includes("el.removeAttribute(attr.name)"), 'sanitizer must strip disallowed attributes');

const detail = fs.readFileSync(new URL('../public/js/modules/mailbox/email-detail.js', import.meta.url), 'utf8');
assert.ok(detail.includes("from '../../core/sanitize.js'"), 'email-detail must import shared sanitize');
assert.ok(!detail.includes('export function sanitizeHtml'), 'email-detail must not keep a duplicate sanitizer');

const css = fs.readFileSync(new URL('../public/css/lookup.css', import.meta.url), 'utf8');
assert.ok(css.includes('.lookup-result[hidden]') && css.includes('.lookup-detail[hidden]'), 'hidden result/detail panels must be display:none');

assert.ok(sanitize.includes('ALLOWED_TAGS'), 'sanitizer must use a tag allowlist');
assert.ok(sanitize.includes("name.startsWith('on')"), 'sanitizer must strip all on* attributes');
assert.ok(sanitize.includes('javascript:'), 'sanitizer must block javascript: URLs');
assert.ok(sanitize.includes('sanitizeElement'), 'sanitizer must process each element once');
assert.ok(sanitize.includes('MAX_DEPTH'), 'sanitizer must cap recursion depth');
assert.ok(sanitize.includes('MAX_NODES'), 'sanitizer must cap node count');

console.log('public-lookup-page: all assertions passed');
