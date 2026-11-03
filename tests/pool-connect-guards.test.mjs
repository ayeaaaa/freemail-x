import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
const unsafe = [...source.matchAll(/req\.on\('end', async \(\) => \{\n\s*const client = await pool\.connect\(\);/g)];

assert.deepEqual(
  unsafe.map((match) => source.slice(0, match.index).split('\n').length),
  [],
  'pool.connect() inside request end handlers must be guarded by try/catch to avoid process crashes'
);
