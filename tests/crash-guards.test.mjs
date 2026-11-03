import assert from 'node:assert/strict';
import fs from 'node:fs';

const backend = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
const smtp = fs.readFileSync(new URL('../tools/smtp-test/server.mjs', import.meta.url), 'utf8');

// 1. Host header / request-target URL parsing must be centralized and guarded.
const urlParseCount = (backend.match(/new URL\(req\.url/g) || []).length;
assert.equal(
  urlParseCount,
  1,
  'new URL(req.url) must only appear inside the guarded parseRequestUrl helper'
);
assert.ok(
  backend.includes('function parseRequestUrl(req)'),
  'backend must define a guarded parseRequestUrl helper'
);
assert.ok(
  backend.includes("send(res, 400, { error: 'bad_request' })"),
  'backend must answer 400 when the request URL cannot be parsed'
);

// 2. Postgres pool must have an error listener so idle client errors cannot crash the process.
assert.ok(
  backend.includes("pool.on('error'"),
  'backend must register pool.on(error) to survive idle database connection errors'
);

// 3. Default-domain lookups inside /api/create and /api/generate must reuse the checked-out client.
const createStart = backend.indexOf("url.pathname === '/mailboxes/create'");
const createEnd = backend.indexOf("url.pathname === '/mailboxes/generate'", createStart);
assert.ok(createStart > 0 && createEnd > createStart, 'expected to locate /api/create route');
const createRoute = backend.slice(createStart, createEnd);
assert.ok(
  createRoute.includes("client.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1')"),
  '/api/create default-domain lookup must use client.query'
);
assert.ok(
  !createRoute.includes("pool.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1')"),
  '/api/create must not check out a second pool connection while holding one'
);

const generateStart = createEnd;
const generateEnd = backend.indexOf("url.pathname === '/mailboxes' || url.pathname === '/api/mailboxes'", generateStart);
assert.ok(generateStart > 0 && generateEnd > generateStart, 'expected to locate /api/generate route');
const generateRoute = backend.slice(generateStart, generateEnd);
assert.ok(
  generateRoute.includes("client.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1')"),
  '/api/generate default-domain lookup must use client.query'
);
assert.ok(
  !generateRoute.includes("pool.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1')"),
  '/api/generate must not check out a second pool connection while holding one'
);

// 4. SMTP ingress must survive connection errors and cap message size.
assert.ok(
  smtp.includes("server.on('error'"),
  'SMTP ingress must register server.on(error) so client aborts cannot crash the process'
);
assert.ok(
  /size:\s*25\s*\*\s*1024\s*\*\s*1024/.test(smtp),
  'SMTP ingress must limit message size to 25MB to avoid memory exhaustion'
);

// 5. SMTP host must be configurable so the deployment can keep dual-stack listening.
assert.ok(
  smtp.includes('process.env.SMTP_HOST'),
  'SMTP ingress listen host must be configurable via SMTP_HOST'
);

console.log('crash-guards: all assertions passed');
