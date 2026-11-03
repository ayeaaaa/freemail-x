import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(
  server.includes('ON CONFLICT (domain) DO NOTHING RETURNING domain'),
  'POST /api/domains must use RETURNING to detect existing domains'
);
assert.ok(
  server.includes('created: result.rowCount > 0'),
  'POST /api/domains must return created flag based on rowCount'
);

console.log('batch-domain-skip (backend): all assertions passed');

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(app.includes('createdCount'), 'batch add must count newly created domains');
assert.ok(app.includes('skippedCount'), 'batch add must count skipped existing domains');
assert.ok(app.includes('data.created'), 'batch add must read created flag from response');

console.log('batch-domain-skip (frontend): all assertions passed');
