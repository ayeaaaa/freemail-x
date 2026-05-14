#!/usr/bin/env node

const VPS_IPV4 = process.env.VPS_IPV4 || '129.213.16.4';
const VPS_IPV6 = process.env.VPS_IPV6 || '2603:c020:401c:5900:0:f375:c928:2f01';
const TTL = Number(process.env.CF_DNS_TTL || 120);

function usage() {
  console.log(`Usage:
  node scripts/migrate-domain-to-vps.mjs --domain example.com --token <cloudflare-api-token>

Optional env:
  VPS_IPV4=129.213.16.4
  VPS_IPV6=2603:c020:401c:5900:0:f375:c928:2f01
  CF_DNS_TTL=120
`);
}

function parseArgs(argv) {
  const args = { domain: '', token: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === '--domain') {
      args.domain = String(next || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (current === '--token') {
      args.token = String(next || '').trim();
      i += 1;
      continue;
    }
    if (current === '--help' || current === '-h') {
      usage();
      process.exit(0);
    }
  }
  return args;
}

async function cfFetch(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const message = json?.errors?.map((item) => item.message).join('; ') || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return json;
}

async function getZone(domain, token) {
  const json = await cfFetch(`/zones?name=${encodeURIComponent(domain)}`, { token });
  return json.result?.[0] || null;
}

async function listDnsRecords(zoneId, token) {
  const json = await cfFetch(`/zones/${zoneId}/dns_records?per_page=200`, { token });
  return json.result || [];
}

async function createRecord(zoneId, token, body) {
  return cfFetch(`/zones/${zoneId}/dns_records`, { token, method: 'POST', body });
}

async function deleteRecord(zoneId, token, recordId) {
  return cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { token, method: 'DELETE' });
}

function normalizeName(name) {
  return String(name || '').replace(/\.$/, '').toLowerCase();
}

function recordMatches(record, expected) {
  return record.type === expected.type
    && normalizeName(record.name) === normalizeName(expected.name)
    && normalizeName(record.content) === normalizeName(expected.content)
    && Number(record.priority || 0) === Number(expected.priority || 0);
}

async function ensureRecord(zoneId, token, existingRecords, expected) {
  const matched = existingRecords.find((record) => recordMatches(record, expected));
  if (matched) return { changed: false, record: matched };
  const json = await createRecord(zoneId, token, expected);
  return { changed: true, record: json.result };
}

async function removeWildcardCloudflareMx(zoneId, token, existingRecords, domain) {
  const wildcardName = `*.${domain}`;
  const targets = new Set([
    'route1.mx.cloudflare.net',
    'route2.mx.cloudflare.net',
    'route3.mx.cloudflare.net'
  ]);
  const records = existingRecords.filter((record) =>
    record.type === 'MX'
    && normalizeName(record.name) === normalizeName(wildcardName)
    && targets.has(normalizeName(record.content))
  );

  for (const record of records) {
    await deleteRecord(zoneId, token, record.id);
  }

  return records.length;
}

async function main() {
  const { domain, token } = parseArgs(process.argv.slice(2));
  if (!domain || !token) {
    usage();
    process.exit(1);
  }

  console.log(`Resolving zone for ${domain}...`);
  const zone = await getZone(domain, token);
  if (!zone) {
    throw new Error(`Zone not found for domain: ${domain}`);
  }

  console.log(`Zone: ${zone.name} (${zone.id}) status=${zone.status}`);
  const mailHost = `mail.${domain}`;
  const wildcardDomain = `*.${domain}`;
  const records = await listDnsRecords(zone.id, token);

  const rootReadOnlyMx = records.filter((record) =>
    record.type === 'MX'
    && normalizeName(record.name) === normalizeName(domain)
    && record.meta?.read_only === true
  );

  if (rootReadOnlyMx.length) {
    console.log('Detected Cloudflare Email Routing managed root MX records.');
    console.log('You must unlock or disable Email Routing for the root domain before root MX can be migrated.');
  }

  const ensured = [];
  ensured.push(await ensureRecord(zone.id, token, records, {
    type: 'A',
    name: 'mail',
    content: VPS_IPV4,
    ttl: TTL,
    proxied: false
  }));
  ensured.push(await ensureRecord(zone.id, token, records, {
    type: 'AAAA',
    name: 'mail',
    content: VPS_IPV6,
    ttl: TTL,
    proxied: false
  }));

  const deletedWildcardCount = await removeWildcardCloudflareMx(zone.id, token, records, domain);
  const refreshedRecords = await listDnsRecords(zone.id, token);

  if (!rootReadOnlyMx.length) {
    ensured.push(await ensureRecord(zone.id, token, refreshedRecords, {
      type: 'MX',
      name: domain,
      content: mailHost,
      priority: 10,
      ttl: TTL
    }));
  }

  ensured.push(await ensureRecord(zone.id, token, refreshedRecords, {
    type: 'MX',
    name: wildcardDomain,
    content: mailHost,
    priority: 1,
    ttl: TTL
  }));

  console.log('');
  console.log('Applied records:');
  console.log(`- ${mailHost} A ${VPS_IPV4}`);
  console.log(`- ${mailHost} AAAA ${VPS_IPV6}`);
  if (!rootReadOnlyMx.length) {
    console.log(`- ${domain} MX 10 ${mailHost}`);
  } else {
    console.log(`- ${domain} MX unchanged because Email Routing is still managing the root MX`);
  }
  console.log(`- ${wildcardDomain} MX 1 ${mailHost}`);

  console.log('');
  console.log('Summary:');
  console.log(`- Changed/created records: ${ensured.filter((item) => item.changed).length}`);
  console.log(`- Removed wildcard Cloudflare MX records: ${deletedWildcardCount}`);
  console.log(`- Root MX migrated: ${rootReadOnlyMx.length ? 'no' : 'yes'}`);
  console.log(`- Zone status: ${zone.status}`);
  if (zone.status !== 'active') {
    console.log('- Note: zone is not active yet; external DNS may not resolve until activation completes.');
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
