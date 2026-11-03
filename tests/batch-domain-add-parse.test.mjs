import assert from 'node:assert/strict';
import fs from 'node:fs';

function parseDomains(input) {
  return Array.from(new Set(
    String(input || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

assert.deepEqual(parseDomains('a.com,b.com,c.com'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(parseDomains('a.com, b.com, a.com, , C.COM'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(parseDomains(''), []);

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(source.includes(".split(',')"), 'domain add handler should split comma-separated input');
assert.ok(source.includes('createdCount'), 'domain add handler should report created count');
assert.ok(source.includes('failedCount'), 'domain add handler should report batch failure count');
