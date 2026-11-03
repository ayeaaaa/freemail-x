import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf("url.pathname === '/mailboxes/create'");
const end = source.indexOf("url.pathname === '/api/generate'", start);
assert.ok(start > 0 && end > start, 'expected to find /api/create route');

const route = source.slice(start, end);
const connectIndex = route.indexOf('client = await pool.connect()');
const tryIndex = route.indexOf('try {');

assert.ok(connectIndex > 0, 'expected /api/create route to acquire a database client');
assert.ok(tryIndex > 0, 'expected /api/create route to have a try block');
assert.ok(
  tryIndex < connectIndex,
  'pool.connect() must be inside try so database connection timeouts return errors instead of crashing the process'
);
assert.ok(route.includes('if (client) client.release();'), 'client release must be guarded when connect fails');
