import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');

assert.ok(source.includes('max: 20'), 'Postgres pool should allow up to 20 connections');
assert.ok(source.includes('connectionTimeoutMillis: 5000'), 'Postgres pool should timeout connection acquisition after 5 seconds');
assert.ok(source.includes('idleTimeoutMillis: 30000'), 'Postgres pool should close idle connections after 30 seconds');
