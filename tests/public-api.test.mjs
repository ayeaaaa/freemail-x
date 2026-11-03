import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes("url.pathname === '/api/public/lookup'"), 'public lookup route must exist');
assert.ok(server.includes("url.pathname.startsWith('/api/public/email/')"), 'public email route must exist');
assert.ok(server.includes('function checkPublicRateLimit(req, res)'), 'public rate limiter must exist');
assert.ok(server.includes("send(res, 429, { error: 'rate_limited' })"), 'rate limit must return 429');
assert.ok(server.includes('/^[a-z0-9]{8}$/'), 'public code must be validated');
assert.ok(server.includes('Number.isSafeInteger(id)'), 'public email id must be a safe integer');
assert.ok(!server.includes('Number.isFinite(id)'), 'public email id must not accept fractional ids');
assert.ok(server.includes("console.error('[public-api]', error)"), 'public routes must log internal errors');
assert.ok(server.includes("send(res, 500, { error: 'internal_error' })"), 'public routes must not leak internal errors');

console.log('public-api: all assertions passed');
