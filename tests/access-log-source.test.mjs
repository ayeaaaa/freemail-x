import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');

assert.ok(source.includes("ACCESS_LOG_FILE"), 'server should define an access log file path');
assert.ok(source.includes("/var/log/freemail-db-api/access.log"), 'server should write access logs to /var/log/freemail-db-api/access.log by default');
assert.ok(source.includes("10 * 1024 * 1024"), 'server should enforce a 10MB access log size limit');
assert.ok(source.includes("access.log.1"), 'server should rotate current access log to access.log.1');
assert.ok(source.includes("installAccessLogger(req, res)"), 'server should install access logging for all requests');
assert.ok(source.includes("type: 'access'"), 'access logs should be structured JSON records');
assert.ok(source.includes("durationMs"), 'access logs should include request duration');
assert.ok(source.includes("userAgent"), 'access logs should include user agent');
assert.ok(!source.includes("authorization: req.headers.authorization"), 'access logs must not include Authorization headers');
assert.ok(!source.includes("cookie: req.headers.cookie"), 'access logs must not include Cookie headers');
