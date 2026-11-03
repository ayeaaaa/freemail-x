import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { migrateDomainToVps } from './src/deploy/cloudflareDomainMigration.js';

const PORT = Number(process.env.PORT || 18100);
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'admin').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const MACHINE_API_KEY = String(process.env.MACHINE_API_KEY || '').trim();
const DEFAULT_MACHINE_TOKEN_ALIAS = String(process.env.DEFAULT_MACHINE_TOKEN_ALIAS || '').trim();
const TOKENS_FILE = process.env.TOKENS_FILE || path.resolve('/opt/freemail-domain-migrator/tokens.json');
const FREEMAIL_BASE_URL = String(process.env.FREEMAIL_BASE_URL || 'http://127.0.0.1:18080').trim().replace(/\/$/, '');
const sessions = new Map();

function readTokenStore() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return [];
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeTokenStore(items) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(items, null, 2));
}

function getSavedTokensMeta() {
  return readTokenStore().map((item) => ({
    alias: item.alias,
    accountId: item.accountId || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  }));
}

function getTokenByAlias(alias) {
  const normalizedAlias = String(alias || '').trim();
  return readTokenStore().find((item) => item.alias === normalizedAlias) || null;
}

function upsertTokenAlias(alias, token, accountId = '') {
  const normalizedAlias = String(alias || '').trim();
  const normalizedToken = String(token || '').trim();
  const normalizedAccountId = String(accountId || '').trim();
  if (!normalizedAlias) throw new Error('缺少别名');
  if (!normalizedToken) throw new Error('缺少 Token');
  const items = readTokenStore();
  const now = new Date().toISOString();
  const existing = items.find((item) => item.alias === normalizedAlias);
  if (existing) {
    existing.token = normalizedToken;
    if (normalizedAccountId) existing.accountId = normalizedAccountId;
    existing.updatedAt = now;
  } else {
    items.push({ alias: normalizedAlias, token: normalizedToken, accountId: normalizedAccountId, createdAt: now, updatedAt: now });
  }
  writeTokenStore(items);
}

function deleteTokenAlias(alias) {
  const normalizedAlias = String(alias || '').trim();
  const items = readTokenStore().filter((item) => item.alias !== normalizedAlias);
  writeTokenStore(items);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

function html(strings, ...values) {
  return String.raw({ raw: strings }, ...values);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.fm_migrator_session;
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { success: false, error: 'unauthorized' });
    return null;
  }
  return session;
}

async function addFreemailDomain(domain) {
  const loginResponse = await fetch(`${FREEMAIL_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_NAME, password: ADMIN_PASSWORD })
  });
  if (!loginResponse.ok) {
    throw new Error(`Freemail 登录失败: ${loginResponse.status}`);
  }

  const setCookie = loginResponse.headers.get('set-cookie') || '';
  const sessionCookie = setCookie.split(';')[0] || '';
  if (!sessionCookie) throw new Error('Freemail 登录未返回 session cookie');

  const response = await fetch(`${FREEMAIL_BASE_URL}/api/domains`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie
    },
    body: JSON.stringify({ domain })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || `Freemail 添加域名失败: ${response.status}`);
  }
  return json;
}

function renderLoginPage() {
  return html`<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>域名迁移工具登录</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
      .wrap { max-width: 440px; margin: 80px auto; background: #111827; padding: 24px; border-radius: 16px; }
      input, button { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #334155; margin-top: 12px; }
      input { background: #0b1220; color: #e2e8f0; }
      button { background: #2563eb; color: white; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h2>域名迁移工具登录</h2>
      <form method="post" action="/login">
        <input name="username" placeholder="管理员用户名" value="admin" />
        <input name="password" type="password" placeholder="管理员密码" />
        <button type="submit">登录</button>
      </form>
    </div>
  </body>
  </html>`;
}

function renderAppPage() {
  const tokenItems = getSavedTokensMeta();
  const autoSelectedAlias = tokenItems.length === 1 ? tokenItems[0].alias : '';
  const tokenOptionsHtml = tokenItems.length
    ? `<option value="">请选择已保存别名</option>${tokenItems.map((item) => `<option value="${escapeHtml(item.alias)}"${item.alias === autoSelectedAlias ? ' selected' : ''}>${escapeHtml(item.alias)}${item.accountId ? ` (${escapeHtml(item.accountId)})` : ''}</option>`).join('')}`
    : '<option value="">暂无已保存别名</option>';
  const currentAliasText = autoSelectedAlias
    ? `当前已保存别名：${escapeHtml(autoSelectedAlias)}`
    : (tokenItems.length ? '当前未选择别名' : '当前没有已保存别名');
  return html`<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>域名迁移工具</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
      .wrap { max-width: 960px; margin: 32px auto; background: #111827; padding: 24px; border-radius: 16px; }
      textarea, input, button { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #334155; margin-top: 12px; box-sizing: border-box; }
      textarea, input { background: #0b1220; color: #e2e8f0; }
      button { background: #2563eb; color: white; cursor: pointer; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .actions { display: flex; gap: 12px; margin-top: 12px; }
      .actions button { flex: 1; }
      pre { background: #020617; padding: 16px; border-radius: 12px; min-height: 220px; white-space: pre-wrap; }
      a { color: #93c5fd; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div style="display:flex; justify-content:space-between; gap:16px; align-items:center;">
        <h2 style="margin:0;">域名迁移工具</h2>
        <div style="display:flex; gap:12px; align-items:center;">
          <a href="/logout">退出</a>
        </div>
      </div>
      <p>一行一个域名，支持批量迁移和 Token 检测。Token 可先保存成别名，后续只选别名，不再重复输入。</p>
      <div style="margin-bottom:12px; color:#93c5fd;">${currentAliasText}</div>
      <div style="background:#0b1220; border:1px solid #334155; padding:16px; border-radius:12px; margin-bottom:16px;">
        <h3 style="margin-top:0;">保存 Cloudflare Token</h3>
        <div class="row">
          <input id="token-alias" placeholder="别名，例如 主账户A" />
          <input id="token-account-id" placeholder="Account ID（可选；迁移时会按域名自动发现）" />
          <input id="token-value" type="password" placeholder="Cloudflare API Token" />
        </div>
        <div class="actions">
          <button id="save-token" type="button">保存 Token 别名</button>
          <button id="refresh-tokens" type="button">刷新别名列表</button>
        </div>
      </div>
      <label>选择已保存的 Token 别名</label>
      <select id="token-alias-select" style="width:100%; padding:12px; border-radius:10px; border:1px solid #334155; margin-top:12px; background:#0b1220; color:#e2e8f0;">${tokenOptionsHtml}</select>
      <div class="actions">
        <button id="delete-token" type="button">删除选中别名</button>
      </div>
      <textarea id="domains" rows="8" placeholder="example.com&#10;foo.com"></textarea>
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
        <input id="auto-create-zone" type="checkbox" style="width:auto; margin:0;" checked />
        <span>域名不存在时自动添加到 Cloudflare（POST /zones）</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
        <input id="auto-add-freemail" type="checkbox" style="width:auto; margin:0;" checked />
        <span>迁移成功后自动加入 Freemail 域名列表（18080 /api/domains）</span>
      </label>
      <div class="row">
        <input id="ipv4" value="1.2.3.4" placeholder="VPS IPv4" />
        <input id="ipv6" value="2001:db8::1" placeholder="VPS IPv6" />
      </div>
      <input id="ttl" type="number" value="120" min="60" placeholder="TTL" />
      <div class="actions">
        <button id="run" onclick="window.__runMigrate && window.__runMigrate()">开始批量迁移</button>
        <button id="verify" type="button" onclick="window.__verifyToken && window.__verifyToken()">先检测 Token</button>
      </div>
      <pre id="result"></pre>
    </div>
    <script>
      const els = {
        domains: document.getElementById('domains'),
        tokenAlias: document.getElementById('token-alias'),
        tokenAccountId: document.getElementById('token-account-id'),
        tokenValue: document.getElementById('token-value'),
        tokenAliasSelect: document.getElementById('token-alias-select'),
        autoCreateZone: document.getElementById('auto-create-zone'),
        autoAddFreemail: document.getElementById('auto-add-freemail'),
        ipv4: document.getElementById('ipv4'),
        ipv6: document.getElementById('ipv6'),
        ttl: document.getElementById('ttl'),
        run: document.getElementById('run'),
        verify: document.getElementById('verify'),
        saveToken: document.getElementById('save-token'),
        refreshTokens: document.getElementById('refresh-tokens'),
        deleteToken: document.getElementById('delete-token'),
        result: document.getElementById('result')
      };

      function setResult(value) { els.result.textContent = value; }

      async function request(payload) {
        const response = await fetch('/api/domain-migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.success === false) throw new Error(json.error || '请求失败');
        return json;
      }

      function formatResults(payload, options = {}) {
        const showNameServers = !!options.showNameServers;
        const lines = [];
        for (const item of payload.results || []) {
          if (item.success) {
            lines.push('[OK] ' + item.domain);
            const result = item.result || {};
            const nameServers = Array.isArray(result.nameServers) ? result.nameServers.filter(Boolean) : [];
            if (showNameServers && result.zoneCreated && nameServers.length) {
              lines.push('nameServers:');
              for (const ns of nameServers.slice(0, 2)) lines.push(ns);
            }
            if (item.freemail && item.freemail.success === false && !item.freemail.skipped) {
              lines.push('Freemail: FAIL');
            }
          } else {
            lines.push('[FAIL] ' + item.domain);
            if (item.error) lines.push(item.error);
          }
          lines.push('');
        }
        return lines.join('\\n').trim();
      }

      async function loadTokens() {
        const response = await fetch('/api/token-aliases');
        const json = await response.json().catch(() => ({ items: [] }));
        const items = Array.isArray(json.items) ? json.items : [];
        els.tokenAliasSelect.innerHTML = items.length
          ? '<option value="">请选择已保存别名</option>' + items.map(item => '<option value="' + item.alias.replace(/"/g, '&quot;') + '">' + item.alias + (item.accountId ? ' (' + item.accountId + ')' : '') + '</option>').join('')
          : '<option value="">暂无已保存别名</option>';
        if (items.length === 1) {
          els.tokenAliasSelect.value = items[0].alias;
        }
      }

      async function saveTokenAlias() {
        try {
          const alias = els.tokenAlias.value.trim();
          const accountId = els.tokenAccountId.value.trim();
          const token = els.tokenValue.value.trim();
          if (!alias || !token) throw new Error('请输入别名和 Token');
          const response = await fetch('/api/token-aliases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias, token, accountId })
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok || json.success === false) throw new Error(json.error || '保存失败');
          els.tokenValue.value = '';
          setResult('Token 别名已保存');
          await loadTokens();
        } catch (error) {
          setResult('保存失败: ' + error.message);
        }
      }

      async function deleteSelectedTokenAlias() {
        try {
          const alias = els.tokenAliasSelect.value.trim();
          if (!alias) throw new Error('没有可删除的别名');
          const response = await fetch('/api/token-aliases', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias })
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok || json.success === false) throw new Error(json.error || '删除失败');
          setResult('Token 别名已删除');
          await loadTokens();
        } catch (error) {
          setResult('删除失败: ' + error.message);
        }
      }

      window.__verifyToken = async () => {
        try {
          const tokenAlias = els.tokenAliasSelect.value.trim();
          if (!tokenAlias) {
            throw new Error('请先保存并选择一个 Token 别名');
          }
          setResult('正在检测 Token...');
          const data = await request({ domains: ['example.com'], tokenAlias, ipv4: '0.0.0.0', ipv6: '::', ttl: 120, dryRun: true });
          const result = data.results?.[0]?.result || {};
          const tokenInfo = result.tokenInfo || {};
          setResult([
            'Token 检测成功',
            'tokenKind: ' + String(tokenInfo.tokenKind || ''),
            'accountId: ' + String(tokenInfo.accountId || ''),
            'verifyStatus: ' + String(tokenInfo.verifyStatus || ''),
            tokenInfo.verifyError ? ('verifyError: ' + tokenInfo.verifyError) : ''
          ].filter(Boolean).join('\\n'));
        } catch (error) {
          setResult('Token 检测失败: ' + error.message);
        }
      };

      window.__runMigrate = async () => {
        try {
          const tokenAlias = els.tokenAliasSelect.value.trim();
          const domainText = els.domains.value.trim();
          if (!tokenAlias) {
            throw new Error('请先保存并选择一个 Token 别名');
          }
          if (!domainText) {
            throw new Error('请输入域名列表，一行一个');
          }
          setResult('正在批量迁移...');
          const data = await request({ domainText, tokenAlias, autoCreateZone: els.autoCreateZone.checked, autoAddFreemail: els.autoAddFreemail.checked, ipv4: els.ipv4.value.trim(), ipv6: els.ipv6.value.trim(), ttl: Number(els.ttl.value || 120) });
          setResult(formatResults(data, { showNameServers: els.autoCreateZone.checked }));
        } catch (error) {
          setResult('批量迁移失败: ' + error.message);
        }
      };

      els.saveToken.addEventListener('click', saveTokenAlias);
      els.refreshTokens.addEventListener('click', loadTokens);
      els.deleteToken.addEventListener('click', deleteSelectedTokenAlias);
      els.verify.addEventListener('click', window.__verifyToken);
      els.run.addEventListener('click', window.__runMigrate);
      loadTokens().catch(() => {});
    </script>
  </body>
  </html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { success: true, service: 'freemail-domain-migrator' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/logout') {
    const cookies = parseCookies(req);
    if (cookies.fm_migrator_session) sessions.delete(cookies.fm_migrator_session);
    send(res, 302, '', { 'Set-Cookie': 'fm_migrator_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict', Location: '/login' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/login') {
    send(res, 200, renderLoginPage(), { 'Content-Type': 'text/html; charset=utf-8' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const username = String(params.get('username') || '').trim();
      const password = String(params.get('password') || '').trim();
      if (username !== ADMIN_NAME || password !== ADMIN_PASSWORD) {
        send(res, 401, 'unauthorized', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const token = crypto.randomUUID();
      sessions.set(token, { username, strictAdmin: true });
      send(res, 302, '', {
        'Set-Cookie': `fm_migrator_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        Location: '/'
      });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/public/domain-migrate') {
    if (MACHINE_API_KEY) {
      const auth = String(req.headers.authorization || '');
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const headerKey = String(req.headers['x-api-key'] || '').trim();
      const queryKey = String(url.searchParams.get('key') || '').trim();
      if (![bearer, headerKey, queryKey].includes(MACHINE_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'unauthorized' });
        return;
      }
    }
    try {
      const body = await readJson(req);
      const domains = Array.isArray(body.domains)
        ? body.domains.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : String(body.domainText || body.domain || '').split(/\r?\n|,|\s+/).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
      if (!domains.length) {
        sendJson(res, 400, { success: false, error: '缺少域名' });
        return;
      }
      const tokenAlias = String(body.tokenAlias || DEFAULT_MACHINE_TOKEN_ALIAS).trim();
      const savedToken = getTokenByAlias(tokenAlias);
      if (!savedToken?.token) {
        sendJson(res, 400, { success: false, error: `未找到已保存 Token 别名: ${tokenAlias}` });
        return;
      }
      const results = [];
      for (const domain of domains) {
        try {
          const result = await migrateDomainToVps({
            domain,
            token: savedToken.token,
            accountId: String(body.accountId || savedToken.accountId || '').trim(),
            autoCreateZone: body.autoCreateZone !== false,
            ipv4: body.ipv4,
            ipv6: body.ipv6,
            ttl: body.ttl
          });
          const nameServers = Array.isArray(result.nameServers) ? result.nameServers.filter(Boolean).slice(0, 2) : [];
          let freemail = { success: false, skipped: true };
          if (body.autoAddFreemail === true) {
            try {
              freemail = { success: true, skipped: false, result: await addFreemailDomain(domain) };
            } catch (error) {
              freemail = { success: false, skipped: false, error: String(error?.message || 'Freemail 添加失败') };
            }
          }
          results.push({
            domain,
            success: true,
            nameServers,
            zoneId: result.zoneId || '',
            zoneCreated: !!result.zoneCreated,
            tokenAlias,
            freemail
          });
        } catch (error) {
          results.push({ domain, success: false, error: String(error?.message || '迁移失败'), tokenAlias });
        }
      }
      const successCount = results.filter((item) => item.success).length;
      sendJson(res, 200, {
        success: successCount > 0,
        total: results.length,
        successCount,
        failedCount: results.length - successCount,
        results
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error?.message || '迁移失败') });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/domain-migrate') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const body = await readJson(req);
      const domains = Array.isArray(body.domains)
        ? body.domains.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : String(body.domainText || body.domain || '').split(/\r?\n|,|\s+/).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
      const tokenAlias = String(body.tokenAlias || '').trim();
      const savedToken = tokenAlias ? getTokenByAlias(tokenAlias) : null;
      const effectiveToken = savedToken?.token || String(body.token || '').trim();
      const effectiveAccountId = String(body.accountId || savedToken?.accountId || '').trim();
      if (!domains.length) {
        sendJson(res, 400, { success: false, error: '缺少域名' });
        return;
      }
      if (!effectiveToken) {
        sendJson(res, 400, { success: false, error: '缺少 Cloudflare API Token 或别名' });
        return;
      }

      if (body.dryRun) {
        const result = await migrateDomainToVps({
          domain: domains[0],
          token: effectiveToken,
          accountId: effectiveAccountId,
          autoCreateZone: !!body.autoCreateZone,
          ipv4: body.ipv4,
          ipv6: body.ipv6,
          ttl: body.ttl,
          dryRun: true
        });
        sendJson(res, 200, { success: true, dryRun: true, results: [{ domain: domains[0], success: true, result }] });
        return;
      }

      const results = [];
      for (const domain of domains) {
        try {
          const result = await migrateDomainToVps({ domain, token: effectiveToken, accountId: effectiveAccountId, autoCreateZone: !!body.autoCreateZone, ipv4: body.ipv4, ipv6: body.ipv6, ttl: body.ttl });
          let freemail = { success: false, skipped: true };
          if (body.autoAddFreemail !== false) {
            try {
              freemail = { success: true, skipped: false, result: await addFreemailDomain(domain) };
            } catch (error) {
              freemail = { success: false, skipped: false, error: String(error?.message || 'Freemail 添加失败') };
            }
          }
          results.push({ domain, success: true, result, freemail });
        } catch (error) {
          results.push({ domain, success: false, error: String(error?.message || '迁移失败') });
        }
      }
      const successCount = results.filter((item) => item.success).length;
      sendJson(res, 200, {
        success: successCount > 0,
        total: results.length,
        successCount,
        failedCount: results.length - successCount,
        results
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error?.message || '迁移失败') });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/token-aliases') {
    const session = requireAdmin(req, res);
    if (!session) return;
    sendJson(res, 200, { success: true, items: getSavedTokensMeta() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/token-aliases') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const body = await readJson(req);
      upsertTokenAlias(body.alias, body.token, body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error?.message || '保存失败') });
    }
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/token-aliases') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const body = await readJson(req);
      deleteTokenAlias(body.alias);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error?.message || '删除失败') });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const session = getSession(req);
    if (!session) {
      send(res, 302, '', { Location: '/login' });
      return;
    }
    send(res, 200, renderAppPage(), { 'Content-Type': 'text/html; charset=utf-8' });
    return;
  }

  send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`freemail-domain-migrator listening on ${PORT}`);
});
