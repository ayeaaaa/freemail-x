/**
 * Cloudflare 域名迁移到 VPS 直收的通用逻辑
 * @module deploy/cloudflareDomainMigration
 */

const DEFAULT_IPV4 = '1.2.3.4';
const DEFAULT_IPV6 = '2001:db8::1';
const DEFAULT_TTL = 120;

function detectTokenKind(token) {
  const value = String(token || '').trim();
  if (value.startsWith('cfat_')) return 'account';
  if (value.startsWith('cfut_')) return 'user';
  return 'legacy-or-unknown';
}

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

async function tryCfFetch(path, options) {
  try {
    const json = await cfFetch(path, options);
    return { ok: true, json };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function discoverTokenContext(token, providedAccountId = '') {
  const tokenKind = detectTokenKind(token);
  let accountId = String(providedAccountId || '').trim();
  let accountName = '';
  let zoneCountHint = 0;
  const errors = [];

  if (!accountId) {
    const accountsProbe = await tryCfFetch('/accounts?per_page=20', { token });
    if (accountsProbe.ok) {
      const accounts = accountsProbe.json.result || [];
      if (accounts.length) {
        accountId = String(accounts[0]?.id || '').trim();
        accountName = String(accounts[0]?.name || '').trim();
      }
    } else {
      errors.push(`accounts: ${accountsProbe.error}`);
    }
  }

  const zonePath = accountId
    ? `/zones?per_page=1&account.id=${encodeURIComponent(accountId)}`
    : '/zones?per_page=1';
  const zonesProbe = await tryCfFetch(zonePath, { token });
  if (zonesProbe.ok) {
    zoneCountHint = Number(zonesProbe.json.result_info?.total_count || zonesProbe.json.result?.length || 0);
    const firstZoneAccount = zonesProbe.json.result?.[0]?.account;
    if (!accountId) accountId = String(firstZoneAccount?.id || firstZoneAccount?.account_id || '').trim();
    if (!accountName) accountName = String(firstZoneAccount?.name || '').trim();
  } else {
    errors.push(`zones: ${zonesProbe.error}`);
  }

  if (!accountId && errors.length) {
    throw new Error(`无法识别 Cloudflare Account ID：${errors.join(' | ')}`);
  }

  return {
    tokenKind,
    accountId,
    accountName,
    zoneCountHint,
    discoveryErrors: errors
  };
}

async function tryVerifyAccountToken(token, accountId) {
  if (!accountId) {
    return { ok: false, error: 'missing account_id' };
  }
  return tryCfFetch(`/accounts/${encodeURIComponent(accountId)}/tokens/verify`, { token });
}

async function verifyCloudflareToken(token, providedAccountId = '') {
  const context = await discoverTokenContext(token, providedAccountId);
  let verifyStatus = 'skipped';
  let verifyError = '';

  if (context.tokenKind === 'account') {
    const verify = await tryVerifyAccountToken(token, context.accountId);
    verifyStatus = verify.ok ? String(verify.json?.result?.status || 'active') : 'failed';
    verifyError = verify.ok ? '' : verify.error;
  }

  return {
    ...context,
    verifyStatus,
    verifyError
  };
}

async function getZone(domain, token, accountId = '') {
  const accountFilter = accountId ? `&account.id=${encodeURIComponent(accountId)}` : '';
  const json = await cfFetch(`/zones?name=${encodeURIComponent(domain)}${accountFilter}`, { token });
  return json.result?.[0] || null;
}

function getZoneAccountInfo(zone = {}) {
  return {
    accountId: String(zone.account?.id || zone.account?.account_id || '').trim(),
    accountName: String(zone.account?.name || '').trim()
  };
}

async function listDnsRecords(zoneId, token) {
  const json = await cfFetch(`/zones/${zoneId}/dns_records?per_page=200`, { token });
  return json.result || [];
}

async function createRecord(zoneId, token, body) {
  const json = await cfFetch(`/zones/${zoneId}/dns_records`, { token, method: 'POST', body });
  return json.result;
}

async function createZone(domain, token, accountId) {
  if (!accountId) throw new Error('添加域名需要 Account ID');
  const json = await cfFetch('/zones', {
    token,
    method: 'POST',
    body: {
      name: domain,
      account: { id: accountId },
      type: 'full'
    }
  });
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
  let record;
  try {
    record = await createRecord(zoneId, token, expected);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('identical record already exists')) {
      const refreshed = await listDnsRecords(zoneId, token);
      const existing = refreshed.find((item) => recordMatches(item, expected));
      if (existing) return { changed: false, record: existing };
    }
    throw error;
  }
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
  const dryRun = !!input.dryRun;
  const accountId = String(input.accountId || '').trim();
  const autoCreateZone = !!input.autoCreateZone;

  if (!domain) throw new Error('缺少域名');
  if (!token) throw new Error('缺少 Cloudflare API Token');

  if (dryRun) {
    const tokenInfo = await verifyCloudflareToken(token, accountId);
    return {
      success: true,
      dryRun: true,
      domain,
      zoneId: null,
      zoneStatus: 'unknown',
      mailHost: `mail.${domain}`,
      ipv4,
      ipv6,
      ttl,
      rootMxManagedByEmailRouting: false,
      rootMxMigrated: false,
      wildcardMxMigrated: false,
      removedWildcardCloudflareMx: 0,
      created: [],
      tokenInfo
    };
  }

  let zone = await getZone(domain, token, accountId);
  let zoneCreated = false;
  let createZoneNameServers = [];
  if (!zone && autoCreateZone) {
    const context = await discoverTokenContext(token, accountId);
    zone = await createZone(domain, token, context.accountId);
    zoneCreated = true;
    createZoneNameServers = zone?.name_servers || [];
  }
  if (!zone) throw new Error(`Cloudflare zone 不存在: ${domain}`);
  const zoneAccount = getZoneAccountInfo(zone);
  let tokenInfo = {
    tokenKind: detectTokenKind(token),
    accountId: zoneAccount.accountId || accountId,
    accountName: zoneAccount.accountName,
    zoneCountHint: 0,
    discoveryErrors: [],
    verifyStatus: 'skipped',
    verifyError: ''
  };

  if (tokenInfo.tokenKind === 'account' && tokenInfo.accountId) {
    const verify = await tryVerifyAccountToken(token, tokenInfo.accountId);
    tokenInfo = {
      ...tokenInfo,
      verifyStatus: verify.ok ? String(verify.json?.result?.status || 'active') : 'failed',
      verifyError: verify.ok ? '' : verify.error
    };
  }

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
    name: mailHost,
    content: ipv4,
    ttl,
    proxied: false
  });
  if (aResult.changed) created.push('A');

  const aaaaResult = await ensureRecord(zone.id, token, records, {
    type: 'AAAA',
    name: mailHost,
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
    zoneCreated,
    nameServers: createZoneNameServers.length ? createZoneNameServers : (zone.name_servers || []),
    removedWildcardCloudflareMx: removedWildcardCount,
    created,
    tokenInfo
  };
}
