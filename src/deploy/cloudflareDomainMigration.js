/**
 * Cloudflare 域名迁移到 VPS 直收的通用逻辑
 * @module deploy/cloudflareDomainMigration
 */

const DEFAULT_IPV4 = '129.213.16.4';
const DEFAULT_IPV6 = '2603:c020:401c:5900:0:f375:c928:2f01';
const DEFAULT_TTL = 120;

function normalizeName(value) {
  return String(value || '').trim().replace(/\.$/, '').toLowerCase();
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
  const json = await cfFetch(`/zones/${zoneId}/dns_records`, { token, method: 'POST', body });
  return json.result;
}

async function deleteRecord(zoneId, token, recordId) {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { token, method: 'DELETE' });
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
  const record = await createRecord(zoneId, token, expected);
  return { changed: true, record };
}

async function removeWildcardCloudflareMx(zoneId, token, existingRecords, domain) {
  const wildcardName = `*.${domain}`;
  const targets = new Set(['route1.mx.cloudflare.net', 'route2.mx.cloudflare.net', 'route3.mx.cloudflare.net']);
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

/**
 * 迁移单个域名到 VPS 直收
 * @param {object} input 输入参数
 * @returns {Promise<object>} 执行结果
 */
export async function migrateDomainToVps(input = {}) {
  const domain = normalizeName(input.domain);
  const token = String(input.token || '').trim();
  const ipv4 = String(input.ipv4 || DEFAULT_IPV4).trim();
  const ipv6 = String(input.ipv6 || DEFAULT_IPV6).trim();
  const ttl = Math.max(60, Number(input.ttl || DEFAULT_TTL) || DEFAULT_TTL);

  if (!domain) throw new Error('缺少域名');
  if (!token) throw new Error('缺少 Cloudflare API Token');

  const zone = await getZone(domain, token);
  if (!zone) throw new Error(`Cloudflare zone 不存在: ${domain}`);

  const mailHost = `mail.${domain}`;
  const wildcardDomain = `*.${domain}`;
  const records = await listDnsRecords(zone.id, token);

  const rootReadOnlyMx = records.filter((record) =>
    record.type === 'MX'
    && normalizeName(record.name) === normalizeName(domain)
    && record.meta?.read_only === true
  );

  const created = [];
  const aResult = await ensureRecord(zone.id, token, records, {
    type: 'A',
    name: 'mail',
    content: ipv4,
    ttl,
    proxied: false
  });
  if (aResult.changed) created.push('A');

  const aaaaResult = await ensureRecord(zone.id, token, records, {
    type: 'AAAA',
    name: 'mail',
    content: ipv6,
    ttl,
    proxied: false
  });
  if (aaaaResult.changed) created.push('AAAA');

  const removedWildcardCount = await removeWildcardCloudflareMx(zone.id, token, records, domain);
  const refreshedRecords = await listDnsRecords(zone.id, token);

  let rootMigrated = false;
  if (!rootReadOnlyMx.length) {
    const rootResult = await ensureRecord(zone.id, token, refreshedRecords, {
      type: 'MX',
      name: domain,
      content: mailHost,
      priority: 10,
      ttl
    });
    if (rootResult.changed) created.push('root-mx');
    rootMigrated = true;
  }

  const wildcardResult = await ensureRecord(zone.id, token, refreshedRecords, {
    type: 'MX',
    name: wildcardDomain,
    content: mailHost,
    priority: 1,
    ttl
  });
  if (wildcardResult.changed) created.push('wildcard-mx');

  return {
    success: true,
    domain,
    zoneId: zone.id,
    zoneStatus: zone.status,
    mailHost,
    ipv4,
    ipv6,
    ttl,
    rootMxManagedByEmailRouting: rootReadOnlyMx.length > 0,
    rootMxMigrated: rootMigrated,
    wildcardMxMigrated: true,
    removedWildcardCloudflareMx: removedWildcardCount,
    created
  };
}
