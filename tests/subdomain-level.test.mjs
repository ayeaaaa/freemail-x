import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes('function buildAddressHost(domain, levels)'), 'backend must define buildAddressHost');
assert.ok(server.includes('Math.max(0, Math.min(7, Number(levels) || 0))'), 'buildAddressHost must clamp 0..7');
assert.ok(server.includes('buildAddressHost(domain, subdomainLevels)'), '/api/generate must use buildAddressHost');
assert.ok(server.includes('buildAddressHost(domain, data.subdomainLevels)'), '/api/create must use buildAddressHost');
assert.ok(!server.includes('Math.max(1, Math.min(7, Number(data.subdomainLevels'), 'old 1..7 clamp must be removed from /api/generate');

console.log('subdomain-level (backend): all assertions passed');

const actions = fs.readFileSync(new URL('../public/js/modules/app/mailbox-actions.js', import.meta.url), 'utf8');
assert.ok(actions.includes('Math.max(0, Math.min(7'), 'getSubdomainLevels must clamp 0..7');
assert.ok(!actions.includes('Number(elements?.subdomainLevelSelect?.value || 3) || 3'), 'old 3-level default must be removed');

const html = fs.readFileSync(new URL('../public/html/app.html', import.meta.url), 'utf8');
assert.ok(html.includes('<option value="0" selected>0 级（根域名）</option>'), 'level select must default to 0 级（根域名）');

const mock = fs.readFileSync(new URL('../public/js/modules/app/mock-api.js', import.meta.url), 'utf8');
assert.ok((mock.match(/subdomainLevels/g) || []).length >= 2, 'mock /api/generate and /api/create must read subdomainLevels');

console.log('subdomain-level (frontend): all assertions passed');
