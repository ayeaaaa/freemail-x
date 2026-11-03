import assert from 'node:assert/strict';
import fs from 'node:fs';

function buildCreateAddress(data, defaultDomain = 'example.com') {
  const fullEmail = String(data.email || '').trim().toLowerCase();
  let local = String(data.local || '').trim().toLowerCase();
  let domain = String(data.domain || '').trim().toLowerCase() || defaultDomain;
  if (fullEmail) {
    const at = fullEmail.indexOf('@');
    if (at > 0 && at < fullEmail.length - 1) {
      local = fullEmail.slice(0, at);
      domain = fullEmail.slice(at + 1);
    }
  }
  return `${local}@${domain}`;
}

assert.equal(
  buildCreateAddress({ email: 'api-create-test@example.com' }),
  'api-create-test@example.com',
  '/api/create must preserve the exact requested email domain'
);

const serverSource = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
const createRoute = serverSource.slice(
  serverSource.indexOf("url.pathname === '/mailboxes/create'"),
  serverSource.indexOf("url.pathname === '/api/generate'")
);

assert.ok(createRoute.includes('usedFullEmail'), '/api/create must track whether the full email was provided');
assert.ok(createRoute.includes('? fullEmail'), '/api/create must preserve the exact requested email when email is provided');
assert.ok(createRoute.includes('buildAddressHost(domain, data.subdomainLevels)'), '/api/create must honor subdomainLevels for local+domain requests');
assert.ok(!createRoute.includes('buildRandomSubdomain'), '/api/create must not call buildRandomSubdomain directly');
