import assert from 'node:assert/strict';
import fs from 'node:fs';

const backend = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
const smtp = fs.readFileSync(new URL('../tools/smtp-test/server.mjs', import.meta.url), 'utf8');
const smtpExtract = fs.readFileSync(new URL('../tools/smtp-test/extract-code.mjs', import.meta.url), 'utf8');

// 1. SMTP actual transfer size must be enforced, not just advertised.
assert.ok(smtp.includes('stream.sizeExceeded'), 'SMTP onData must check stream.sizeExceeded');
assert.ok(smtp.includes('responseCode = 552'), 'SMTP oversized message must respond with 552');

// 2. stripHtml must be linear: no lazy-quantifier script/style regex.
assert.ok(!smtp.includes('[\\s\\S]*?</script>') && !smtpExtract.includes('[\\s\\S]*?</script>'), 'lazy <script> regex must be removed');
assert.ok(smtpExtract.includes('function removeTagBlocks'), 'linear removeTagBlocks helper must exist');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `function ${name} not found`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `function ${name} end not found`);
  return source.slice(start, end + 2);
}

const factory = new Function(
  `${extractFunction(smtpExtract, 'removeTagBlocks')}\n${extractFunction(smtpExtract, 'stripHtml')}\nreturn { stripHtml };`
);
const { stripHtml } = factory();

assert.equal(stripHtml('<p>Hello</p><script>evil()</script> world'), 'Hello world');
assert.equal(stripHtml('<style>body{color:red}</style>text'), 'text');
assert.equal(stripHtml(''), '');

const adversarial = '<script'.repeat(50000) + '</script>';
const startedAt = Date.now();
const result = stripHtml(adversarial);
const elapsedMs = Date.now() - startedAt;
assert.equal(result, '');
assert.ok(elapsedMs < 1000, `stripHtml must stay linear, took ${elapsedMs}ms`);

// 3. serveStaticFile must be guarded against fs errors.
const staticFn = backend.slice(backend.indexOf('function serveStaticFile'), backend.indexOf('function sendText'));
assert.ok(staticFn.includes('try {') && staticFn.includes('catch'), 'serveStaticFile must catch fs errors');

// 4. /api/generate length must be clamped.
assert.ok(
  /Math\.max\(1,\s*Math\.min\(64,\s*Number\(data\.length/.test(backend),
  'generate length must be clamped to 1-64'
);

// 5. Request bodies must be size-limited.
assert.ok(backend.includes('payload_too_large'), 'oversized bodies must be rejected with 413');
assert.ok(backend.includes('bodyLimitBytes'), 'body limit must be enforced');

// 6. getOrCreateMailbox must be race-safe.
assert.ok(backend.includes('ON CONFLICT (address) DO NOTHING'), 'mailbox insert must be race-safe');

console.log('live-hardening: all assertions passed');
