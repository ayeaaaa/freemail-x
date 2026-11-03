import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

const PORT = Number(process.env.PORT || 18080);
const STATIC_DIR = process.env.STATIC_DIR || '/opt/freemail-db-api/public';
const TOKEN = process.env.API_TOKEN || '';
const ADMIN_NAME = process.env.ADMIN_NAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const JWT_TOKEN = process.env.JWT_TOKEN || '';
const MAIL_DOMAINS = String(process.env.MAIL_DOMAIN || '').split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const MINIMAL_ADMIN_ONLY = String(process.env.MINIMAL_ADMIN_ONLY || '1') !== '0';
const ACCESS_LOG_FILE = process.env.ACCESS_LOG_FILE || '/var/log/freemail-db-api/access.log';
const ACCESS_LOG_MAX_BYTES = Number(process.env.ACCESS_LOG_MAX_BYTES || 10 * 1024 * 1024);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

pool.on('error', (error) => {
  console.error('[pool.error]', error.message);
});

async function ensureDomainsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domains (
      id BIGSERIAL PRIMARY KEY,
      domain TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const domain of MAIL_DOMAINS) {
    if (!domain) continue;
    await pool.query('INSERT INTO domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING', [domain]);
  }
}

const ready = ensureDomainsTable().catch(err => {
  console.error('init domains table failed:', err);
});

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function rotateAccessLogIfNeeded() {
  try {
    if (!ACCESS_LOG_FILE || !ACCESS_LOG_MAX_BYTES) return;
    if (!fs.existsSync(ACCESS_LOG_FILE)) return;
    const stat = fs.statSync(ACCESS_LOG_FILE);
    if (stat.size < ACCESS_LOG_MAX_BYTES) return;
    const rotated = path.join(path.dirname(ACCESS_LOG_FILE), 'access.log.1');
    try { fs.rmSync(rotated, { force: true }); } catch (_) {}
    fs.renameSync(ACCESS_LOG_FILE, rotated);
  } catch (error) {
    console.error('[access-log.rotate.failed]', error.message);
  }
}

function writeAccessLog(record) {
  try {
    if (!ACCESS_LOG_FILE) return;
    fs.mkdirSync(path.dirname(ACCESS_LOG_FILE), { recursive: true });
    rotateAccessLogIfNeeded();
    fs.appendFileSync(ACCESS_LOG_FILE, `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.error('[access-log.write.failed]', error.message);
  }
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    return null;
  }
}

function installAccessLogger(req, res) {
  const started = Date.now();
  const parsed = parseRequestUrl(req);
  const pathname = parsed ? parsed.pathname : String(req.url || '').split('?')[0];
  const originalWriteHead = res.writeHead.bind(res);
  const originalEnd = res.end.bind(res);
  let statusCode = 200;
  let logged = false;

  res.writeHead = function patchedWriteHead(status, ...args) {
    statusCode = Number(status) || statusCode;
    return originalWriteHead(status, ...args);
  };

  res.end = function patchedEnd(...args) {
    if (!logged) {
      logged = true;
      const record = {
        type: 'access',
        ts: new Date().toISOString(),
        method: req.method,
        path: pathname,
        status: statusCode,
        durationMs: Date.now() - started,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
        pid: process.pid
      };
      writeAccessLog(record);
    }
    return originalEnd(...args);
  };
}

function sendResponse(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

function serveStaticFile(res, pathname) {
  try {
    const safePath = pathname === '/' ? '/lookup.html' : pathname;
    const filePath = path.join(STATIC_DIR, safePath.replace(/^\/+/, ''));
    if (!filePath.startsWith(path.resolve(STATIC_DIR))) return false;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const data = fs.readFileSync(filePath);
    sendResponse(res, 200, data, { 'Content-Type': contentTypeFor(filePath) });
    return true;
  } catch (error) {
    console.error('[static.failed]', error.message);
    return false;
  }
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function ensureAuthorized(req, res) {
  const auth = req.headers.authorization || '';
  const ok = auth === `Bearer ${TOKEN}` || (!!JWT_TOKEN && auth === `Bearer ${JWT_TOKEN}`);
  if (!ok) {
    send(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

function hasApiToken(req) {
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN}` || (!!JWT_TOKEN && auth === `Bearer ${JWT_TOKEN}`);
}

function toPgSql(sql) {
  let index = 0;
  return String(sql || '').replace(/\?/g, () => `$${++index}`);
}

async function getOrCreateMailbox(client, address) {
  const normalized = String(address || '').trim().toLowerCase();
  const existing = await client.query('SELECT id, access_code FROM mailboxes WHERE address = $1 LIMIT 1', [normalized]);
  if (existing.rows[0]?.id) {
    return { id: existing.rows[0].id, accessCode: existing.rows[0].access_code || null };
  }
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) throw new Error('invalid_mailbox');
  const accessCode = await generateUniqueAccessCode(client);
  await client.query(
    'INSERT INTO mailboxes (address, local_part, domain, password_hash, last_accessed_at, access_code) VALUES ($1, $2, $3, NULL, CURRENT_TIMESTAMP, $4) ON CONFLICT (address) DO NOTHING',
    [normalized, localPart, domain, accessCode]
  );
  const created = await client.query('SELECT id, access_code FROM mailboxes WHERE address = $1 LIMIT 1', [normalized]);
  if (!created.rows[0]?.id) throw new Error('mailbox_create_failed');
  return { id: created.rows[0].id, accessCode: created.rows[0].access_code || null };
}

function createJwt(payload, expiresInSeconds = 31536000) {
  if (!JWT_TOKEN) throw new Error('missing_jwt_token');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds, ...payload })).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', JWT_TOKEN).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function parseRequestCookies(req) {
  const raw = req.headers.cookie || '';
  const map = new Map();
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return map;
}

function verifySession(req) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = bearerToken || parseRequestCookies(req).get('iding-session') || '';
    const parts = token.split('.');
    if (parts.length !== 3 || !JWT_TOKEN) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const sig = crypto.createHmac('sha256', JWT_TOKEN).update(data).digest('base64url');
    if (sig !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function ensureSession(req, res) {
  const payload = verifySession(req);
  if (!payload) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  return payload;
}

function ensureSessionOrApiToken(req, res) {
  if (hasApiToken(req)) return { role: 'api' };
  return ensureSession(req, res);
}

function isDisabledByMinimalMode(url) {
  if (!MINIMAL_ADMIN_ONLY) return false;
  const disabledPrefixes = [
    '/api/users',
    '/api/send',
    '/api/sent'
  ];
  const disabledExact = new Set([
    '/api/mailbox/favorite',
    '/api/mailbox/forward',
    '/api/mailboxes/batch-favorite',
    '/api/mailboxes/batch-forward',
    '/api/mailboxes/batch-favorite-by-address',
    '/api/mailboxes/batch-forward-by-address'
  ]);
  if (disabledExact.has(url.pathname)) return true;
  return disabledPrefixes.some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function generateRandomId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateAccessCode() {
  return generateRandomId(8);
}

async function generateUniqueAccessCode(client) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateAccessCode();
    const taken = await client.query('SELECT 1 FROM mailboxes WHERE access_code = $1 LIMIT 1', [code]);
    if (!taken.rows[0]) return code;
  }
  throw new Error('access_code_generation_failed');
}

function buildRandomSubdomain(levels = 1, labelLength = 6) {
  const count = Math.max(1, Math.min(7, Number(levels) || 1));
  const size = Math.max(3, Math.min(24, Number(labelLength) || 6));
  return Array.from({ length: count }, () => generateRandomId(size)).join('.');
}

function buildAddressHost(domain, levels) {
  const count = Math.max(0, Math.min(7, Number(levels) || 0));
  return count > 0 ? `${buildRandomSubdomain(count)}.${domain}` : domain;
}

const publicRateBuckets = new Map();
function checkPublicRateLimit(req, res) {
  const ip = String(req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 30;
  const recent = (publicRateBuckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    send(res, 429, { error: 'rate_limited' });
    return false;
  }
  recent.push(now);
  publicRateBuckets.set(ip, recent);
  if (publicRateBuckets.size > 5000) {
    for (const [key, times] of publicRateBuckets) {
      if (!times.some((t) => now - t < windowMs)) publicRateBuckets.delete(key);
    }
  }
  return true;
}

const server = http.createServer((req, res) => {
  installAccessLogger(req, res);

  if (req.url === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  const url = parseRequestUrl(req);
  if (!url) {
    send(res, 400, { error: 'bad_request' });
    return;
  }

  const bodyLimitBytes = url.pathname === '/inbound-email' || url.pathname === '/query'
    ? 32 * 1024 * 1024
    : 2 * 1024 * 1024;
  let receivedBytes = 0;
  let bodyRejected = false;
  const rejectOversizedBody = () => {
    if (bodyRejected) return;
    bodyRejected = true;
    if (res.headersSent || res.writableEnded) {
      req.destroy();
      return;
    }
    res.setHeader('Connection', 'close');
    send(res, 413, { success: false, error: 'payload_too_large' });
    res.once('finish', () => req.destroy());
  };
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > bodyLimitBytes) {
    rejectOversizedBody();
    return;
  }
  req.on('data', (chunk) => {
    if (bodyRejected) return;
    receivedBytes += chunk.length;
    if (receivedBytes > bodyLimitBytes) rejectOversizedBody();
  });

  if (req.method === 'GET' && !url.pathname.startsWith('/api/') && req.url !== '/query' && req.url !== '/inbound-email') {
    if (serveStaticFile(res, url.pathname)) return;
  }

  if (isDisabledByMinimalMode(url)) {
    send(res, 404, { error: 'not_found' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/public/lookup') {
    if (!checkPublicRateLimit(req, res)) return;
    (async () => {
      try {
        const code = String(url.searchParams.get('code') || '').trim().toLowerCase();
        if (!/^[a-z0-9]{8}$/.test(code)) {
          send(res, 400, { error: 'invalid_code' });
          return;
        }
        const mailbox = await pool.query(
          'SELECT id, address, created_at FROM mailboxes WHERE access_code = $1 LIMIT 1',
          [code]
        );
        if (!mailbox.rows[0]) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        const emails = await pool.query(
          'SELECT id, sender, subject, received_at, preview, verification_code FROM messages WHERE mailbox_id = $1 ORDER BY id DESC LIMIT 50',
          [mailbox.rows[0].id]
        );
        send(res, 200, {
          address: mailbox.rows[0].address,
          created_at: mailbox.rows[0].created_at,
          emails: emails.rows || []
        });
      } catch (error) {
        console.error('[public-api]', error);
        send(res, 500, { error: 'internal_error' });
      }
    })();
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/public/email/')) {
    if (!checkPublicRateLimit(req, res)) return;
    (async () => {
      try {
        const code = String(url.searchParams.get('code') || '').trim().toLowerCase();
        if (!/^[a-z0-9]{8}$/.test(code)) {
          send(res, 400, { error: 'invalid_code' });
          return;
        }
        const id = Number(url.pathname.split('/')[4]);
        if (!Number.isSafeInteger(id) || id <= 0) {
          send(res, 400, { error: 'invalid_id' });
          return;
        }
        const mailbox = await pool.query('SELECT id FROM mailboxes WHERE access_code = $1 LIMIT 1', [code]);
        if (!mailbox.rows[0]) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        const message = await pool.query(
          'SELECT id, sender, to_addrs, subject, received_at, content, html_content, verification_code FROM messages WHERE id = $1 AND mailbox_id = $2 LIMIT 1',
          [id, mailbox.rows[0].id]
        );
        if (!message.rows[0]) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        send(res, 200, message.rows[0]);
      } catch (error) {
        console.error('[public-api]', error);
        send(res, 500, { error: 'internal_error' });
      }
    })();
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/auth/login' || url.pathname === '/api/login')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const username = String(payload.username || '').trim().toLowerCase();
        const password = String(payload.password || '').trim();
        if (username !== String(ADMIN_NAME).trim().toLowerCase() || password !== ADMIN_PASSWORD) {
          send(res, 401, { error: 'invalid_credentials' });
          return;
        }
        const token = createJwt({ role: 'admin', username: ADMIN_NAME, userId: 1 });
        res.setHeader('Set-Cookie', `iding-session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=31536000`);
        send(res, 200, { success: true, role: 'admin', username: ADMIN_NAME, can_send: 1, mailbox_limit: 9999 });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    sendResponse(res, 200, JSON.stringify({ success: true }), {
      'Content-Type': 'application/json',
      'Set-Cookie': 'iding-session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/auth/session' || url.pathname === '/api/session')) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    send(res, 200, { authenticated: true, role: payload.role || 'admin', username: payload.username || '', strictAdmin: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/domains') {
    (async () => {
      await ready;
      const result = await pool.query('SELECT domain FROM domains ORDER BY id ASC');
      send(res, 200, result.rows.map(r => r.domain));
    })().catch(error => send(res, 500, { success: false, error: error.message }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/domains') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        await ready;
        const data = JSON.parse(body || '{}');
        const domain = String(data.domain || '').trim().toLowerCase();
        if (!domain) {
          send(res, 400, { error: '缺少域名' });
          return;
        }
        const result = await pool.query(
          'INSERT INTO domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING domain',
          [domain]
        );
        send(res, 200, { success: true, domain, created: result.rowCount > 0 });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/domains/')) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        await ready;
        const domain = decodeURIComponent(url.pathname.replace('/api/domains/', '')).trim().toLowerCase();
        await pool.query('DELETE FROM domains WHERE domain = $1', [domain]);
        send(res, 200, { success: true, domain });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/mailboxes/create' || url.pathname === '/api/create')) {
    const payload = url.pathname === '/api/create' ? ensureSessionOrApiToken(req, res) : ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let client;
      try {
        client = await pool.connect();
        const data = JSON.parse(body || '{}');
        const fullEmail = String(data.email || '').trim().toLowerCase();
        let local = String(data.local || '').trim().toLowerCase();
        let domain = String(data.domain || '').trim().toLowerCase();
        if (!domain) {
          const d = await client.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1');
          domain = String(d.rows?.[0]?.domain || '').trim().toLowerCase();
        }
        let usedFullEmail = false;
        if (fullEmail) {
          const at = fullEmail.indexOf('@');
          if (at > 0 && at < fullEmail.length - 1) {
            local = fullEmail.slice(0, at);
            domain = fullEmail.slice(at + 1);
            usedFullEmail = true;
          }
        }
        if (!local || !domain) {
          send(res, 400, { error: 'invalid_mailbox' });
          return;
        }
        const address = usedFullEmail
          ? fullEmail
          : `${local}@${buildAddressHost(domain, data.subdomainLevels)}`;
        const mailbox = await getOrCreateMailbox(client, address);
        send(res, 200, { email: address, expires: Date.now() + 3600000, success: true, mailbox_id: mailbox.id, access_code: mailbox.accessCode });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      } finally {
        if (client) client.release();
      }
    });
    return;
  }

  if ((req.method === 'POST' && url.pathname === '/mailboxes/generate') || url.pathname === '/api/generate') {
    const payload = url.pathname === '/api/generate' ? ensureSessionOrApiToken(req, res) : ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let client;
      try {
        client = await pool.connect();
        const data = body ? JSON.parse(body || '{}') : {};
        const length = Math.max(1, Math.min(64, Number(data.length || url.searchParams.get('length') || 8) || 8));
        let domain = String(data.domain || url.searchParams.get('domain') || '').trim().toLowerCase();
        if (!domain) {
          const d = await client.query('SELECT domain FROM domains ORDER BY id ASC LIMIT 1');
          domain = String(d.rows?.[0]?.domain || '').trim().toLowerCase();
        }
        const rawLevels = data.subdomainLevels ?? url.searchParams.get('subdomainLevels');
        const subdomainLevels = Math.max(0, Math.min(7, Number(rawLevels ?? 0) || 0));
        const local = generateRandomId(length);
        const address = `${local}@${buildAddressHost(domain, subdomainLevels)}`;
        const mailbox = await getOrCreateMailbox(client, address);
        send(res, 200, { email: address, expires: Date.now() + 3600000, success: true, mailbox_id: mailbox.id, access_code: mailbox.accessCode });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      } finally {
        if (client) client.release();
      }
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/mailboxes' || url.pathname === '/api/mailboxes')) {
    const payload = url.pathname.startsWith('/api/') ? ensureSession(req, res) : null;
    if (url.pathname === '/mailboxes' && !ensureAuthorized(req, res)) return;
    if (url.pathname === '/api/mailboxes' && !payload) return;
    (async () => {
      try {
        let limit, offset;
        const pageParam = url.searchParams.get('page');
        const sizeParam = url.searchParams.get('size');
        if (pageParam !== null || sizeParam !== null) {
          const page = Math.max(1, Number(pageParam || 1));
          const size = Math.max(1, Math.min(500, Number(sizeParam || 20)));
          limit = size;
          offset = (page - 1) * size;
        } else {
          limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 20)));
          offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        }
        const whereConditions = [];
        const bindParams = [];
        const searchParam = url.searchParams.get('q');
        const domainParam = url.searchParams.get('domain');
        const loginParam = url.searchParams.get('login');
        const favoriteParam = url.searchParams.get('favorite');
        const forwardParam = url.searchParams.get('forward');

        if (searchParam && searchParam.trim()) {
          whereConditions.push('LOWER(address) LIKE $' + (bindParams.length + 1));
          bindParams.push(`%${searchParam.trim().toLowerCase()}%`);
        }

        if (domainParam && domainParam.trim()) {
          whereConditions.push('domain = $' + (bindParams.length + 1));
          bindParams.push(String(domainParam).trim().toLowerCase());
        }

        if (loginParam === 'true' || loginParam === '1' || loginParam === 'allowed') {
          whereConditions.push('can_login = 1');
        } else if (loginParam === 'false' || loginParam === '0' || loginParam === 'denied') {
          whereConditions.push('(can_login = 0 OR can_login IS NULL)');
        }

        if (favoriteParam === 'true' || favoriteParam === '1' || favoriteParam === 'favorite') {
          whereConditions.push('is_favorite = 1');
        } else if (favoriteParam === 'false' || favoriteParam === '0' || favoriteParam === 'not-favorite') {
          whereConditions.push('(is_favorite = 0 OR is_favorite IS NULL)');
        }

        if (forwardParam === 'true' || forwardParam === '1' || forwardParam === 'has-forward') {
          whereConditions.push("(forward_to IS NOT NULL AND forward_to != '')");
        } else if (forwardParam === 'false' || forwardParam === '0' || forwardParam === 'no-forward') {
          whereConditions.push("(forward_to IS NULL OR forward_to = '')");
        }

        const whereClause = whereConditions.length ? ` WHERE ${whereConditions.join(' AND ')}` : '';
        if (searchParam || domainParam || loginParam || favoriteParam || forwardParam) {
          console.log('[mailboxes.search]', JSON.stringify({
            q: searchParam,
            domain: domainParam,
            login: loginParam,
            favorite: favoriteParam,
            forward: forwardParam,
            whereClause,
            bindParams
          }));
        }
        const result = await pool.query(
          `SELECT id, address, access_code, created_at, is_pinned, CASE WHEN (password_hash IS NULL OR password_hash = '') THEN 1 ELSE 0 END AS password_is_default, can_login, forward_to, is_favorite FROM mailboxes${whereClause} ORDER BY id DESC LIMIT $${bindParams.length + 1} OFFSET $${bindParams.length + 2}`,
          [...bindParams, limit, offset]
        );
        const total = await pool.query(
          `SELECT COUNT(*)::int AS total FROM mailboxes${whereClause}`,
          bindParams
        );
        const rows = result.rows || [];
        if (payload && payload.role !== 'admin') {
          for (const row of rows) delete row.access_code;
        }
        send(res, 200, { list: rows, total: total.rows?.[0]?.total || 0 });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && (url.pathname.startsWith('/mailboxes/') || url.pathname === '/api/mailbox/info')) {
    if (url.pathname.startsWith('/mailboxes/') && !ensureAuthorized(req, res)) return;
    const payload = url.pathname === '/api/mailbox/info' ? ensureSession(req, res) : null;
    if (url.pathname === '/api/mailbox/info' && !payload) return;
    (async () => {
      try {
        const address = url.pathname === '/api/mailbox/info'
          ? String(url.searchParams.get('address') || '').trim().toLowerCase()
          : decodeURIComponent(url.pathname.replace('/mailboxes/', '')).trim().toLowerCase();
        const result = await pool.query(
          'SELECT id, address, access_code, is_favorite, forward_to, can_login, created_at FROM mailboxes WHERE address = $1 LIMIT 1',
          [address]
        );
        if (!result.rows[0]) {
          if (url.pathname === '/api/mailbox/info') {
            const info = { id: null, address, is_favorite: false, forward_to: null, can_login: false };
            if (payload && payload.role === 'admin') info.access_code = null;
            send(res, 200, info);
            return;
          }
          send(res, 404, { error: 'not_found' });
          return;
        }
        if (url.pathname === '/api/mailbox/info') {
          const info = {
            id: result.rows[0].id,
            address: result.rows[0].address,
            is_favorite: !!result.rows[0].is_favorite,
            forward_to: result.rows[0].forward_to || null,
            can_login: !!result.rows[0].can_login
          };
          if (payload.role === 'admin') info.access_code = result.rows[0].access_code || null;
          send(res, 200, info);
          return;
        }
        send(res, 200, result.rows[0]);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/user/quota') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const total = await pool.query('SELECT COUNT(*)::int AS used FROM mailboxes');
        send(res, 200, { limit: -1, used: total.rows?.[0]?.used || 0, remaining: -1, note: '管理员无邮箱数量限制' });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/emails' || url.pathname === '/api/emails')) {
    if (url.pathname === '/emails' && !ensureAuthorized(req, res)) return;
    const payload = url.pathname === '/api/emails' ? ensureSessionOrApiToken(req, res) : null;
    if (url.pathname === '/api/emails' && !payload) return;
    (async () => {
      try {
        const mailbox = String(url.searchParams.get('mailbox') || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 20)));
        const result = await pool.query(
          'SELECT m.id, m.sender, m.to_addrs, m.subject, m.received_at, m.is_read, m.preview, m.verification_code FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE mb.address = $1 ORDER BY m.id DESC LIMIT $2',
          [mailbox, limit]
        );
        send(res, 200, result.rows || []);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if ((req.method === 'GET' && url.pathname.startsWith('/emails/')) || (req.method === 'GET' && url.pathname.startsWith('/api/email/'))) {
    const isApiPath = url.pathname.startsWith('/api/email/');
    if (!isApiPath && !ensureAuthorized(req, res)) return;
    const payload = isApiPath ? ensureSessionOrApiToken(req, res) : null;
    if (isApiPath && !payload) return;
    (async () => {
      try {
        const id = isApiPath
          ? Number(url.pathname.split('/')[3])
          : Number(url.pathname.replace('/emails/', '').replace('/source', ''));
        const isSource = !isApiPath && url.pathname.endsWith('/source');
        const isDownload = isApiPath && url.pathname.endsWith('/download');
        const result = await pool.query(
          'SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read, content, html_content FROM messages WHERE id = $1 LIMIT 1',
          [id]
        );
        if (!result.rows[0]) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        if (isSource) {
          send(res, 200, { r2_bucket: result.rows[0].r2_bucket, r2_object_key: result.rows[0].r2_object_key });
          return;
        }
        if (isDownload) {
          send(res, 410, { error: 'raw_email_not_retained' });
          return;
        }
        if (isApiPath) {
          send(res, 200, { ...result.rows[0], download: '' });
          return;
        }
        send(res, 200, result.rows[0]);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailbox/favorite') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const current = await pool.query('SELECT is_favorite FROM mailboxes WHERE id = $1 LIMIT 1', [mailboxId]);
        const next = current.rows?.[0]?.is_favorite ? 0 : 1;
        await pool.query('UPDATE mailboxes SET is_favorite = $1 WHERE id = $2', [next, mailboxId]);
        send(res, 200, { success: true, mailbox_id: mailboxId, is_favorite: next });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailbox/forward') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const forwardTo = data.forward_to ? String(data.forward_to).trim() : null;
        await pool.query('UPDATE mailboxes SET forward_to = $1 WHERE id = $2', [forwardTo, mailboxId]);
        send(res, 200, { success: true, mailbox_id: mailboxId, forward_to: forwardTo });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/pin') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const address = String(url.searchParams.get('address') || '').trim().toLowerCase();
        const mailbox = await pool.query('SELECT id, is_pinned FROM mailboxes WHERE address = $1 LIMIT 1', [address]);
        if (!mailbox.rows[0]) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        const next = mailbox.rows[0].is_pinned ? 0 : 1;
        await pool.query('UPDATE mailboxes SET is_pinned = $1 WHERE id = $2', [next, mailbox.rows[0].id]);
        send(res, 200, { success: true, address, is_pinned: next });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/toggle-login') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const current = await pool.query('SELECT can_login FROM mailboxes WHERE id = $1 LIMIT 1', [mailboxId]);
        const next = current.rows?.[0]?.can_login ? 0 : 1;
        await pool.query('UPDATE mailboxes SET can_login = $1 WHERE id = $2', [next, mailboxId]);
        send(res, 200, { success: true, mailbox_id: mailboxId, can_login: next });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/reset-password') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const defaultPassword = '123456';
        await pool.query('UPDATE mailboxes SET password_hash = $1 WHERE id = $2', [sha256Hex(defaultPassword), mailboxId]);
        send(res, 200, { success: true, mailbox_id: mailboxId, password: defaultPassword });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/change-password') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const password = String(data.password || '').trim();
        if (!password) {
          send(res, 400, { error: '缺少密码' });
          return;
        }
        await pool.query('UPDATE mailboxes SET password_hash = $1 WHERE id = $2', [sha256Hex(password), mailboxId]);
        send(res, 200, { success: true, mailbox_id: mailboxId });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/mailbox/password') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxId = Number(data.mailbox_id);
        const password = String(data.password || '').trim();
        if (!password) {
          send(res, 400, { error: '缺少密码' });
          return;
        }
        await pool.query('UPDATE mailboxes SET password_hash = $1 WHERE id = $2', [sha256Hex(password), mailboxId]);
        send(res, 200, { success: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/batch-toggle-login') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const mailboxIds = Array.isArray(data.mailbox_ids) ? data.mailbox_ids.map(Number).filter(Boolean) : [];
        const canLogin = data.can_login ? 1 : 0;
        if (!mailboxIds.length) {
          send(res, 400, { error: '缺少邮箱 ID 列表' });
          return;
        }
        const placeholders = mailboxIds.map((_, idx) => `$${idx + 2}`).join(',');
        await pool.query(`UPDATE mailboxes SET can_login = $1 WHERE id IN (${placeholders})`, [canLogin, ...mailboxIds]);
        send(res, 200, { success: true, updated_count: mailboxIds.length, can_login: canLogin });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/mailboxes') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const address = String(url.searchParams.get('address') || '').trim().toLowerCase();
        const mailbox = await pool.query('SELECT id FROM mailboxes WHERE address = $1 LIMIT 1', [address]);
        if (!mailbox.rows[0]?.id) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        await pool.query('DELETE FROM messages WHERE mailbox_id = $1', [mailbox.rows[0].id]);
        await pool.query('DELETE FROM user_mailboxes WHERE mailbox_id = $1', [mailbox.rows[0].id]);
        await pool.query('DELETE FROM mailboxes WHERE id = $1', [mailbox.rows[0].id]);
        send(res, 200, { success: true, deleted: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/emails/batch') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const ids = String(url.searchParams.get('ids') || '').split(',').map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
        if (!ids.length) {
          send(res, 200, []);
          return;
        }
        const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(',');
        const result = await pool.query(
          `SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read, content, html_content FROM messages WHERE id IN (${placeholders})`,
          ids
        );
        send(res, 200, result.rows || []);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/emails') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const mailbox = String(url.searchParams.get('mailbox') || '').trim().toLowerCase();
        const mailboxResult = await pool.query('SELECT id FROM mailboxes WHERE address = $1 LIMIT 1', [mailbox]);
        if (!mailboxResult.rows[0]?.id) {
          send(res, 200, { success: true, deletedCount: 0 });
          return;
        }
        const result = await pool.query('DELETE FROM messages WHERE mailbox_id = $1', [mailboxResult.rows[0].id]);
        send(res, 200, { success: true, deletedCount: result.rowCount || 0 });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/email/')) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const emailId = Number(url.pathname.split('/')[3]);
        const result = await pool.query('DELETE FROM messages WHERE id = $1', [emailId]);
        send(res, 200, { success: true, deleted: (result.rowCount || 0) > 0, message: (result.rowCount || 0) > 0 ? '邮件已删除' : '邮件不存在或已被删除' });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const result = await pool.query('SELECT u.id, u.username, u.role, u.mailbox_limit, u.can_send, u.created_at, 0::int AS mailbox_count FROM users u ORDER BY created_at DESC LIMIT 100');
        send(res, 200, result.rows || []);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const username = String(data.username || '').trim().toLowerCase();
        const role = data.role === 'admin' ? 'admin' : 'user';
        const mailboxLimit = Math.max(0, Number(data.mailboxLimit || 10));
        const canSend = data.can_send ? 1 : 0;
        await pool.query('INSERT INTO users (username, role, can_send, mailbox_limit) VALUES ($1, $2, $3, $4)', [username, role, canSend, mailboxLimit]);
        const created = await pool.query('SELECT id, username, role, mailbox_limit, can_send, created_at FROM users WHERE username = $1 LIMIT 1', [username]);
        send(res, 200, created.rows[0]);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/users/')) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const userId = Number(url.pathname.split('/')[3]);
        const data = JSON.parse(body || '{}');
        if (typeof data.mailboxLimit !== 'undefined') {
          await pool.query('UPDATE users SET mailbox_limit = $1 WHERE id = $2', [Math.max(0, Number(data.mailboxLimit)), userId]);
        }
        if (typeof data.role === 'string') {
          await pool.query('UPDATE users SET role = $1 WHERE id = $2', [data.role === 'admin' ? 'admin' : 'user', userId]);
        }
        if (typeof data.can_send !== 'undefined') {
          await pool.query('UPDATE users SET can_send = $1 WHERE id = $2', [data.can_send ? 1 : 0, userId]);
        }
        send(res, 200, { success: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && /^\/api\/users\/\d+$/.test(url.pathname)) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const userId = Number(url.pathname.split('/')[3]);
        await pool.query('DELETE FROM user_mailboxes WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        send(res, 200, { success: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'GET' && /^\/api\/users\/\d+\/mailboxes$/.test(url.pathname)) {
    const payload = ensureSession(req, res);
    if (!payload) return;
    (async () => {
      try {
        const userId = Number(url.pathname.split('/')[3]);
        const result = await pool.query(
          'SELECT m.address, um.created_at, um.is_pinned FROM user_mailboxes um JOIN mailboxes m ON m.id = um.mailbox_id WHERE um.user_id = $1 ORDER BY um.is_pinned DESC, um.created_at DESC',
          [userId]
        );
        send(res, 200, result.rows || []);
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users/assign') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let client;
      try {
        client = await pool.connect();
        const data = JSON.parse(body || '{}');
        const username = String(data.username || '').trim().toLowerCase();
        const address = String(data.address || '').trim().toLowerCase();
        const user = await client.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
        if (!user.rows[0]?.id) {
          send(res, 404, { error: '用户不存在' });
          return;
        }
        const mailbox = await getOrCreateMailbox(client, address);
        await client.query('INSERT INTO user_mailboxes (user_id, mailbox_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, mailbox.id]);
        send(res, 200, { success: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      } finally {
        if (client) client.release();
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users/unassign') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const username = String(data.username || '').trim().toLowerCase();
        const address = String(data.address || '').trim().toLowerCase();
        const user = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
        const mailbox = await pool.query('SELECT id FROM mailboxes WHERE address = $1 LIMIT 1', [address]);
        if (!user.rows[0]?.id || !mailbox.rows[0]?.id) {
          send(res, 400, { error: '该邮箱未分配给该用户' });
          return;
        }
        await pool.query('DELETE FROM user_mailboxes WHERE user_id = $1 AND mailbox_id = $2', [user.rows[0].id, mailbox.rows[0].id]);
        send(res, 200, { success: true });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/batch-favorite-by-address') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const addresses = Array.isArray(data.addresses) ? data.addresses.map(v => String(v).trim().toLowerCase()).filter(Boolean) : [];
        const favoriteValue = data.is_favorite ? 1 : 0;
        if (!addresses.length) {
          send(res, 400, { error: '缺少邮箱地址列表' });
          return;
        }
        const placeholders = addresses.map((_, idx) => `$${idx + 2}`).join(',');
        await pool.query(`UPDATE mailboxes SET is_favorite = $1 WHERE address IN (${placeholders})`, [favoriteValue, ...addresses]);
        send(res, 200, { success: true, updated_count: addresses.length, is_favorite: favoriteValue });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mailboxes/batch-forward-by-address') {
    const payload = ensureSession(req, res);
    if (!payload) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const addresses = Array.isArray(data.addresses) ? data.addresses.map(v => String(v).trim().toLowerCase()).filter(Boolean) : [];
        const forwardTo = data.forward_to ? String(data.forward_to).trim() : null;
        if (!addresses.length) {
          send(res, 400, { error: '缺少邮箱地址列表' });
          return;
        }
        const placeholders = addresses.map((_, idx) => `$${idx + 2}`).join(',');
        await pool.query(`UPDATE mailboxes SET forward_to = $1 WHERE address IN (${placeholders})`, [forwardTo, ...addresses]);
        send(res, 200, { success: true, updated_count: addresses.length, forward_to: forwardTo });
      } catch (error) {
        send(res, 500, { success: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/inbound-email') {
    if (!ensureAuthorized(req, res)) return;

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      let client;
      try {
        client = await pool.connect();
        const payload = JSON.parse(body || '{}');
        const mailbox = String(payload.mailbox || '').trim().toLowerCase();
        const sender = String(payload.sender || '').trim().toLowerCase();
        const toAddrs = String(payload.to_addrs || payload.mailbox || '').trim();
        const subject = String(payload.subject || '(无主题)');
        const verificationCode = payload.verification_code || null;
        const preview = payload.preview || null;
        const r2Bucket = payload.r2_bucket || null;
        const r2ObjectKey = payload.r2_object_key || null;
        const content = payload.content || null;
        const htmlContent = payload.html_content || null;

        if (!mailbox) {
          send(res, 400, { error: 'missing_mailbox' });
          return;
        }

        await client.query('BEGIN');
        const mailboxRecord = await getOrCreateMailbox(client, mailbox);
        const inserted = await client.query(
          'INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, content, html_content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
          [mailboxRecord.id, sender, toAddrs, subject, verificationCode, preview, r2Bucket, r2ObjectKey, content, htmlContent]
        );
        await client.query('COMMIT');
        send(res, 200, { success: true, mailbox_id: mailboxRecord.id, message_id: inserted.rows[0]?.id || null });
      } catch (error) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch (_) {}
        }
        send(res, 500, { success: false, error: error.message });
      } finally {
        if (client) client.release();
      }
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/query') {
    send(res, 404, { error: 'not_found' });
    return;
  }

  if (!ensureAuthorized(req, res)) return;

  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const sql = String(payload.sql || '').trim();
      const params = Array.isArray(payload.params) ? payload.params : [];
      if (!sql) {
        send(res, 400, { error: 'missing_sql' });
        return;
      }
      const result = await pool.query(toPgSql(sql), params);
      send(res, 200, {
        success: true,
        results: result.rows || [],
        meta: { changes: result.rowCount || 0 }
      });
    } catch (error) {
      send(res, 500, { success: false, error: error.message });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`freemail-db-api listening on ${PORT}`);
});
