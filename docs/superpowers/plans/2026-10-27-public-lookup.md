# 公开访问码查询页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增公开默认页 `/`：输入 8 位访问码查看对应邮箱与邮件内容（只读）；访问码只对新邮箱生成；管理端仍在 `/index.html`。

**Architecture:** `mailboxes` 新增 `access_code`（部分唯一索引）；`getOrCreateMailbox` 新建邮箱时生成唯一 8 位 `[a-z0-9]` 码并返回；新增无需登录的只读 `/api/public/lookup` 与 `/api/public/email/<id>`（带内存限流）；`/` 返回新的 `lookup.html`，原应用留在 `/index.html` 并修正所有跳转。

**Tech Stack:** Node.js（无框架 http + pg）、原生 ES Module 前端、PostgreSQL、Node `assert` 静态测试、Playwright（Firefox）E2E。

## Global Constraints

- 用户处于 no-commit 模式：**不执行任何 git commit**；每个任务以“部署到 VPS + 验证”代替提交步骤。
- 部署目标：`ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4>`。
- 后端 live 路径 `/opt/freemail-db-api/server.mjs`，服务 `freemail-db-api`，重启 `systemctl restart freemail-db-api`。
- 前端 live 路径前缀 `/opt/freemail-db-api/public/`（静态文件，无需重启）。
- 部署后必须 md5 一致；后端重启后 `systemctl is-active freemail-db-api` 为 `active`。
- 访问码：8 位 `[a-z0-9]`，**只对新创建的邮箱生成**；老邮箱 `access_code IS NULL`，不 backfill。
- 公开接口无需登录、只读；限流 30 次/分钟/IP；lookup 最多返回 50 封邮件。
- `/` 返回 `lookup.html`；原管理应用地址为 `/index.html`。
- 登录接口：`POST /api/login`，body `{"username":"admin","password":"<ADMIN_PASSWORD>"}`，Cookie 名 `iding-session`。
- 验证用域名：`example.com`；测试邮箱/邮件验证后必须清理。

---

### Task 1: 后端 access_code（数据库 + 创建/返回）

**Files:**
- Modify: `.remote-freemail-server.mjs`（`getOrCreateMailbox`、`generateAccessCode`、4 个调用点、mailboxes 列表、mailbox/info）
- Test: `tests/access-code.test.mjs`（新建）

**Interfaces:**
- Produces:
  - `generateAccessCode()` → 8 位 `[a-z0-9]`
  - `generateUniqueAccessCode(client)` → 预检 5 次，返回未被占用的码
  - `getOrCreateMailbox(client, address)` → `{ id, accessCode }`（老邮箱 `accessCode` 为 `null`）
  - `/api/create`、`/api/generate` 响应新增 `access_code`
  - `/api/mailboxes` 列表、`/api/mailbox/info` 返回 `access_code`

- [ ] **Step 1: 写失败测试**

新建 `tests/access-code.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes('function generateAccessCode()'), 'backend must define generateAccessCode');
assert.ok(server.includes('async function generateUniqueAccessCode(client)'), 'backend must pre-check access code uniqueness');
assert.ok(server.includes('SELECT id, access_code FROM mailboxes WHERE address = $1'), 'getOrCreateMailbox must read access_code');
assert.ok(
  server.includes('VALUES ($1, $2, $3, NULL, CURRENT_TIMESTAMP, $4) ON CONFLICT (address) DO NOTHING'),
  'mailbox insert must persist access_code'
);
assert.ok(server.includes('access_code: mailbox.accessCode'), 'create/generate responses must include access_code');
assert.ok(server.includes('access_code: result.rows[0].access_code'), 'mailbox info must include access_code');
assert.ok(server.includes('SELECT id, address, access_code, created_at'), 'mailbox list must select access_code');

console.log('access-code: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/access-code.test.mjs`
Expected: FAIL — `backend must define generateAccessCode`

- [ ] **Step 3: 实现后端改动**

编辑 A：在 `generateRandomId` 之后新增：

```js
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
```

编辑 B：`getOrCreateMailbox` 整体替换为：

```js
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
```

编辑 C：`/api/create` 中：

```js
        const mailboxId = await getOrCreateMailbox(client, address);
        send(res, 200, { email: address, expires: Date.now() + 3600000, success: true, mailbox_id: mailboxId });
```

替换为：

```js
        const mailbox = await getOrCreateMailbox(client, address);
        send(res, 200, { email: address, expires: Date.now() + 3600000, success: true, mailbox_id: mailbox.id, access_code: mailbox.accessCode });
```

编辑 D：`/api/generate` 中同样替换（该处代码与编辑 C 相同）。

编辑 E：`/api/users/assign` 中：

```js
        const mailboxId = await getOrCreateMailbox(client, address);
        await client.query('INSERT INTO user_mailboxes (user_id, mailbox_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, mailboxId]);
```

替换为：

```js
        const mailbox = await getOrCreateMailbox(client, address);
        await client.query('INSERT INTO user_mailboxes (user_id, mailbox_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, mailbox.id]);
```

编辑 F：`/inbound-email` 中：

```js
        const mailboxId = await getOrCreateMailbox(client, mailbox);
        const inserted = await client.query(
          'INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, content, html_content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
          [mailboxId, sender, toAddrs, subject, verificationCode, preview, r2Bucket, r2ObjectKey, content, htmlContent]
        );
```

替换为：

```js
        const mailboxRecord = await getOrCreateMailbox(client, mailbox);
        const inserted = await client.query(
          'INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, content, html_content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
          [mailboxRecord.id, sender, toAddrs, subject, verificationCode, preview, r2Bucket, r2ObjectKey, content, htmlContent]
        );
```

并将该处理器响应中的 `mailbox_id: mailboxId` 改为 `mailbox_id: mailboxRecord.id`。

编辑 G：`/api/mailboxes` 的 SELECT 中，`SELECT id, address, created_at, ...` 改为 `SELECT id, address, access_code, created_at, ...`。

编辑 H：`/api/mailbox/info` 的 SELECT 改为 `SELECT id, address, access_code, is_favorite, forward_to, can_login, created_at FROM mailboxes WHERE address = $1 LIMIT 1`；响应对象增加 `access_code: result.rows[0].access_code || null`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/access-code.test.mjs && node --check .remote-freemail-server.mjs`
Expected: PASS + 语法检查通过

- [ ] **Step 5: 线上数据库迁移（先于部署）**

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<'EOF'
docker exec freemail-postgres psql -U freemail_app -d freemail <<'SQL'
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS access_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_access_code_key ON mailboxes(access_code) WHERE access_code IS NOT NULL;
\d mailboxes
SQL
EOF
```

Expected: 表结构包含 `access_code`，索引 `mailboxes_access_code_key` 存在。

- [ ] **Step 6: 部署后端并重启**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no .remote-freemail-server.mjs root@<VPS_IPV4>:/opt/freemail-db-api/server.mjs
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/server.mjs && systemctl restart freemail-db-api && sleep 6 && systemctl is-active freemail-db-api && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/health"
md5sum .remote-freemail-server.mjs
```

Expected: 两端 md5 一致；`active`；`200`。

- [ ] **Step 7: 线上验证 access_code**

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<'EOF'
set -e
curl -s -c /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' >/dev/null
TS=$(date +%s)
LOCAL="codetest$TS"
RESP=$(curl -s -b /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/create -H 'Content-Type: application/json' -d "{\"local\":\"$LOCAL\",\"domain\":\"example.com\",\"subdomainLevels\":0}")
echo "create: $RESP"
CODE=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_code||''))")
echo "$CODE" | grep -qE '^[a-z0-9]{8}$' && echo OK-CODE
echo "list: $(curl -s -b /tmp/fmck.txt "http://127.0.0.1:18080/api/mailboxes?q=$LOCAL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.list||[])[0]?.access_code||'')})")"
echo "info: $(curl -s -b /tmp/fmck.txt "http://127.0.0.1:18080/api/mailbox/info?address=$LOCAL%40example.com" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.access_code||'')})")"
OLD=$(docker exec freemail-postgres psql -U freemail_app -d freemail -t -A -c "SELECT address FROM mailboxes WHERE access_code IS NULL LIMIT 1")
echo "old mailbox: $OLD"
curl -s -b /tmp/fmck.txt "http://127.0.0.1:18080/api/mailbox/info?address=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$OLD")" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('old_code='+(j.access_code===null?'null':j.access_code))})"
curl -s -b /tmp/fmck.txt -X DELETE "http://127.0.0.1:18080/api/mailboxes?address=$LOCAL%40example.com"; echo
rm -f /tmp/fmck.txt
EOF
```

Expected: `OK-CODE`；`list` 与 `info` 输出同一 8 位码；`old_code=null`；清理 `{"success":true,...}`。

---

### Task 2: 公开只读 API + 限流

**Files:**
- Modify: `.remote-freemail-server.mjs`（限流器 + 两个公开路由）
- Test: `tests/public-api.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `access_code`
- Produces:
  - `GET /api/public/lookup?code=XXXXXXXX` → `{ address, created_at, emails }`（emails 最多 50）
  - `GET /api/public/email/<id>?code=XXXXXXXX` → `{ id, sender, to_addrs, subject, received_at, content, html_content, verification_code }`
  - 400 `invalid_code` / 404 `not_found` / 429 `rate_limited`

- [ ] **Step 1: 写失败测试**

新建 `tests/public-api.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes("url.pathname === '/api/public/lookup'"), 'public lookup route must exist');
assert.ok(server.includes("url.pathname.startsWith('/api/public/email/')"), 'public email route must exist');
assert.ok(server.includes('function checkPublicRateLimit(req, res)'), 'public rate limiter must exist');
assert.ok(server.includes("send(res, 429, { error: 'rate_limited' })"), 'rate limit must return 429');
assert.ok(server.includes('/^[a-z0-9]{8}$/'), 'public code must be validated');

console.log('public-api: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/public-api.test.mjs`
Expected: FAIL — `public lookup route must exist`

- [ ] **Step 3: 实现公开路由与限流**

先在模块作用域（`const server = http.createServer(...)` 之前）新增限流器。**必须放在请求处理器外**，否则每个请求都会重建 Map，限流永远不会触发：

```js
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
```

然后在 `isDisabledByMinimalMode` 代码块之后、登录路由之前插入两个公开路由：

```js
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
        send(res, 500, { success: false, error: error.message });
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
        if (!Number.isFinite(id) || id <= 0) {
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
        send(res, 500, { success: false, error: error.message });
      }
    })();
    return;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/public-api.test.mjs && node --check .remote-freemail-server.mjs`
Expected: PASS

- [ ] **Step 5: 部署后端并重启**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no .remote-freemail-server.mjs root@<VPS_IPV4>:/opt/freemail-db-api/server.mjs
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/server.mjs && systemctl restart freemail-db-api && sleep 6 && systemctl is-active freemail-db-api"
md5sum .remote-freemail-server.mjs
```

Expected: md5 一致；`active`。

- [ ] **Step 6: 线上验证公开接口**

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<'EOF'
set -e
curl -s -c /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' >/dev/null
TS=$(date +%s)
LOCAL="pubtest$TS"
RESP=$(curl -s -b /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/create -H 'Content-Type: application/json' -d "{\"local\":\"$LOCAL\",\"domain\":\"example.com\",\"subdomainLevels\":0}")
CODE=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_code||''))")
echo "code=$CODE"
echo "lookup:"
curl -s "http://127.0.0.1:18080/api/public/lookup?code=$CODE"
echo
echo "invalid:"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:18080/api/public/lookup?code=zz"
echo "missing:"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:18080/api/public/lookup?code=zzzzzzzz"
echo "detail missing:"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:18080/api/public/email/999999999?code=$CODE"
curl -s -b /tmp/fmck.txt -X DELETE "http://127.0.0.1:18080/api/mailboxes?address=$LOCAL%40example.com"; echo
rm -f /tmp/fmck.txt
echo "rate limit (31 requests):"
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code} ' "http://127.0.0.1:18080/api/public/lookup?code=zzzzzzzz"; done
echo
EOF
```

Expected: `lookup` 返回该地址与空 `emails`；`invalid`=400；`missing`=404；`detail missing`=404；清理成功；限流序列最后出现 `429`。

---

### Task 3: 公开查询页 + 共享 HTML 消毒

**Files:**
- Create: `public/js/core/sanitize.js`、`public/lookup.html`、`public/css/lookup.css`、`public/js/lookup.js`
- Modify: `public/js/modules/mailbox/email-detail.js`（改为导入 sanitize）
- Test: `tests/public-lookup-page.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 2 的公开接口
- Produces: `/lookup.html` 可直接访问（`/` 的切换在 Task 5）

- [ ] **Step 1: 写失败测试**

新建 `tests/public-lookup-page.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/lookup.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="access-code-input"'), 'lookup page must have access code input');
assert.ok(html.includes('maxlength="8"'), 'access code input must be limited to 8 chars');
assert.ok(html.includes('/js/lookup.js'), 'lookup page must load lookup.js');
assert.ok(html.includes('noindex'), 'lookup page must be noindex');

const js = fs.readFileSync(new URL('../public/js/lookup.js', import.meta.url), 'utf8');
assert.ok(js.includes('/api/public/lookup'), 'lookup.js must call public lookup API');
assert.ok(js.includes('/api/public/email/'), 'lookup.js must call public email API');
assert.ok(js.includes('sanitizeHtml'), 'lookup.js must sanitize HTML');

const sanitize = fs.readFileSync(new URL('../public/js/core/sanitize.js', import.meta.url), 'utf8');
assert.ok(sanitize.includes('export function sanitizeHtml'), 'shared sanitize module must export sanitizeHtml');

const detail = fs.readFileSync(new URL('../public/js/modules/mailbox/email-detail.js', import.meta.url), 'utf8');
assert.ok(detail.includes("from '../../core/sanitize.js'"), 'email-detail must import shared sanitize');
assert.ok(!detail.includes('export function sanitizeHtml'), 'email-detail must not keep a duplicate sanitizer');

console.log('public-lookup-page: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/public-lookup-page.test.mjs`
Expected: FAIL — ENOENT `public/lookup.html`

- [ ] **Step 3: 实现共享消毒模块**

新建 `public/js/core/sanitize.js`，内容为从 `public/js/modules/mailbox/email-detail.js` **原样搬移**的 `sanitizeHtml`（保留原有危险标签/属性清理逻辑），仅加上 `export`：

```js
export function sanitizeHtml(html) {
  if (!html) return '';

  const temp = document.createElement('div');
  temp.innerHTML = html;

  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form'];
  dangerousTags.forEach(tag => {
    const elements = temp.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });

  const dangerousAttrs = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'];
  const allElements = temp.querySelectorAll('*');
  allElements.forEach(el => {
    dangerousAttrs.forEach(attr => {
      el.removeAttribute(attr);
    });

    if (el.hasAttribute('href') && el.getAttribute('href').toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('href');
    }
    if (el.hasAttribute('src') && el.getAttribute('src').toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('src');
    }
  });

  return temp.innerHTML;
}
```

然后从 `public/js/modules/mailbox/email-detail.js` 删除该函数，并在文件顶部 import 中加入：

```js
import { sanitizeHtml } from '../../core/sanitize.js';
```

- [ ] **Step 4: 实现公开页**

新建 `public/lookup.html`：

```html
<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>访问码查邮箱 - iDing's 临时邮箱</title>
  <link rel="stylesheet" href="/css/tokens.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <link rel="stylesheet" href="/css/theme-switcher.css" />
  <link rel="stylesheet" href="/css/lookup.css" />
</head>
<body class="lookup-page">
  <header class="lookup-header">
    <a class="lookup-brand" href="/">
      <span class="lookup-brand-icon">✉</span>
      <span>iDing's 临时邮箱</span>
    </a>
    <a class="lookup-login-link" href="/html/login.html">管理登录</a>
  </header>

  <main class="lookup-main">
    <section class="lookup-hero">
      <h1>输入访问码查看邮箱</h1>
      <p class="lookup-subtitle">8 位数字 + 字母组合 · 只读查看</p>
      <form id="lookup-form" class="lookup-form">
        <input id="access-code-input" class="input lookup-input" type="text" maxlength="8" autocomplete="off" spellcheck="false" placeholder="例如 a1b2c3d4" aria-label="8 位访问码" />
        <button id="lookup-btn" class="btn btn-primary" type="submit">查询</button>
      </form>
      <p id="lookup-error" class="lookup-error" role="alert"></p>
    </section>

    <section id="lookup-result" class="lookup-result" hidden>
      <div class="card lookup-mailbox">
        <div>
          <div class="lookup-label">邮箱地址</div>
          <div id="lookup-address" class="lookup-address"></div>
        </div>
        <div class="lookup-mailbox-actions">
          <button id="lookup-copy" class="btn btn-secondary btn-sm" type="button">复制地址</button>
          <button id="lookup-refresh" class="btn btn-ghost btn-sm" type="button">刷新</button>
        </div>
      </div>

      <div class="card lookup-emails-card">
        <div class="lookup-emails-header">
          <span>邮件</span>
          <span id="lookup-count" class="lookup-count"></span>
        </div>
        <div id="lookup-email-list" class="lookup-email-list"></div>
      </div>
    </section>

    <section id="lookup-detail" class="card lookup-detail" hidden>
      <div class="lookup-detail-header">
        <div>
          <div id="lookup-detail-subject" class="lookup-detail-subject"></div>
          <div id="lookup-detail-meta" class="lookup-detail-meta"></div>
        </div>
        <button id="lookup-detail-close" class="btn btn-ghost btn-sm" type="button">关闭</button>
      </div>
      <div id="lookup-detail-body" class="lookup-detail-body"></div>
    </section>
  </main>

  <footer class="lookup-footer">仅用于查看临时邮箱 · 数据保留 3 天</footer>

  <script src="/js/theme.js" defer></script>
  <script type="module" src="/js/lookup.js"></script>
</body>
</html>
```

新建 `public/css/lookup.css`：

```css
.lookup-page {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}

.lookup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 880px;
  margin: 0 auto;
  padding: 20px 24px;
}

.lookup-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}

.lookup-brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
}

.lookup-login-link {
  color: var(--text-3);
  font-size: 13px;
  text-decoration: none;
}

.lookup-login-link:hover { color: var(--accent); }

.lookup-main {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.lookup-hero { text-align: center; padding: 32px 0 8px; }
.lookup-hero h1 { margin: 0 0 8px; font-size: 28px; }
.lookup-subtitle { margin: 0 0 24px; color: var(--text-3); }

.lookup-form {
  display: flex;
  gap: 10px;
  justify-content: center;
  max-width: 520px;
  margin: 0 auto;
}

.lookup-input {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 18px;
  letter-spacing: 2px;
  text-align: center;
}

.lookup-error { min-height: 20px; margin: 12px 0 0; color: var(--danger); font-size: 13px; }
.lookup-result { display: flex; flex-direction: column; gap: 16px; }
.lookup-mailbox { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.lookup-label { color: var(--text-3); font-size: 12px; margin-bottom: 4px; }
.lookup-address { font-family: var(--font-mono); font-size: 16px; word-break: break-all; }
.lookup-mailbox-actions { display: flex; gap: 8px; flex-shrink: 0; }
.lookup-emails-header { display: flex; justify-content: space-between; color: var(--text-3); font-size: 13px; margin-bottom: 12px; }
.lookup-email-list { display: flex; flex-direction: column; gap: 8px; }
.lookup-empty { color: var(--text-3); text-align: center; padding: 24px 0; }

.lookup-email-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.lookup-email-item:hover { border-color: var(--accent); }
.lookup-email-top { display: flex; justify-content: space-between; gap: 12px; color: var(--text-3); font-size: 12px; }
.lookup-email-sender { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lookup-email-subject { font-size: 14px; font-weight: 600; }
.lookup-email-code { align-self: flex-start; margin-top: 2px; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft, rgba(99, 102, 241, 0.12)); color: var(--accent); font-family: var(--font-mono); font-size: 12px; }

.lookup-detail { display: flex; flex-direction: column; gap: 12px; }
.lookup-detail-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.lookup-detail-subject { font-size: 16px; font-weight: 700; }
.lookup-detail-meta { color: var(--text-3); font-size: 12px; margin-top: 4px; }
.lookup-detail-body { font-size: 14px; line-height: 1.7; word-break: break-word; }
.lookup-detail-body.is-text { white-space: pre-wrap; }
.lookup-detail-body img { max-width: 100%; height: auto; }
.lookup-footer { text-align: center; color: var(--text-3); font-size: 12px; padding: 24px; }

@media (max-width: 640px) {
  .lookup-header { padding: 16px; }
  .lookup-main { padding: 16px; }
  .lookup-hero { padding-top: 16px; }
  .lookup-hero h1 { font-size: 22px; }
  .lookup-form { flex-direction: column; }
  .lookup-mailbox { flex-direction: column; align-items: flex-start; }
}
```

新建 `public/js/lookup.js`：

```js
import { sanitizeHtml } from './core/sanitize.js';
import { formatTime, escapeHtml } from './core/utils.js';

const els = {
  form: document.getElementById('lookup-form'),
  input: document.getElementById('access-code-input'),
  btn: document.getElementById('lookup-btn'),
  error: document.getElementById('lookup-error'),
  result: document.getElementById('lookup-result'),
  address: document.getElementById('lookup-address'),
  copy: document.getElementById('lookup-copy'),
  refresh: document.getElementById('lookup-refresh'),
  list: document.getElementById('lookup-email-list'),
  count: document.getElementById('lookup-count'),
  detail: document.getElementById('lookup-detail'),
  detailSubject: document.getElementById('lookup-detail-subject'),
  detailMeta: document.getElementById('lookup-detail-meta'),
  detailBody: document.getElementById('lookup-detail-body'),
  detailClose: document.getElementById('lookup-detail-close')
};

let currentCode = '';
let currentAddress = '';

function normalizeCode(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

function showError(message) {
  if (els.error) els.error.textContent = message || '';
}

function hideDetail() {
  if (els.detail) els.detail.hidden = true;
}

function renderEmails(emails) {
  if (!els.list) return;
  if (els.count) els.count.textContent = emails.length ? `共 ${emails.length} 封` : '';
  if (!emails.length) {
    els.list.innerHTML = '<div class="lookup-empty">暂无邮件</div>';
    return;
  }
  els.list.innerHTML = emails.map((email) => `
    <button type="button" class="lookup-email-item" data-id="${email.id}">
      <span class="lookup-email-top">
        <span class="lookup-email-sender">${escapeHtml(email.sender || '未知发件人')}</span>
        <span class="lookup-email-time">${escapeHtml(formatTime(email.received_at))}</span>
      </span>
      <span class="lookup-email-subject">${escapeHtml(email.subject || '(无主题)')}</span>
      ${email.verification_code ? `<span class="lookup-email-code">验证码 ${escapeHtml(email.verification_code)}</span>` : ''}
    </button>
  `).join('');
}

async function lookup(code) {
  showError('');
  hideDetail();
  if (els.result) els.result.hidden = true;
  if (els.btn) els.btn.disabled = true;
  try {
    const res = await fetch('/api/public/lookup?code=' + encodeURIComponent(code));
    if (res.status === 400) { showError('访问码格式不对，请输入 8 位数字或字母'); return; }
    if (res.status === 404) { showError('访问码不存在，或邮箱已过期'); return; }
    if (res.status === 429) { showError('查询太频繁，请稍后再试'); return; }
    if (!res.ok) { showError('查询失败，请稍后再试'); return; }
    const data = await res.json();
    currentCode = code;
    currentAddress = data.address || '';
    if (els.address) els.address.textContent = currentAddress;
    if (els.result) els.result.hidden = false;
    renderEmails(data.emails || []);
  } catch (_) {
    showError('网络错误，请稍后再试');
  } finally {
    if (els.btn) els.btn.disabled = false;
  }
}

async function openEmail(id) {
  if (!currentCode) return;
  try {
    const res = await fetch('/api/public/email/' + encodeURIComponent(id) + '?code=' + encodeURIComponent(currentCode));
    if (!res.ok) return;
    const email = await res.json();
    if (els.detailSubject) els.detailSubject.textContent = email.subject || '(无主题)';
    if (els.detailMeta) els.detailMeta.textContent = `${email.sender || '未知发件人'} · ${formatTime(email.received_at)}`;
    if (els.detailBody) {
      if (email.html_content) {
        els.detailBody.classList.remove('is-text');
        els.detailBody.innerHTML = sanitizeHtml(email.html_content);
      } else {
        els.detailBody.classList.add('is-text');
        els.detailBody.textContent = email.content || '';
      }
    }
    if (els.detail) els.detail.hidden = false;
    els.detail?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {}
}

async function copyAddress() {
  if (!currentAddress) return;
  try {
    await navigator.clipboard.writeText(currentAddress);
    if (els.copy) {
      els.copy.textContent = '已复制';
      setTimeout(() => { els.copy.textContent = '复制地址'; }, 1200);
    }
  } catch (_) {
    showError('复制失败，请手动选择复制');
  }
}

els.form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = normalizeCode(els.input?.value);
  if (els.input) els.input.value = code;
  if (code.length !== 8) {
    showError('请输入 8 位数字或字母');
    return;
  }
  lookup(code);
});

els.input?.addEventListener('input', () => {
  els.input.value = normalizeCode(els.input.value);
});

els.list?.addEventListener('click', (event) => {
  const item = event.target.closest('.lookup-email-item');
  if (item?.dataset?.id) openEmail(item.dataset.id);
});

els.copy?.addEventListener('click', copyAddress);
els.refresh?.addEventListener('click', () => { if (currentCode) lookup(currentCode); });
els.detailClose?.addEventListener('click', hideDetail);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node tests/public-lookup-page.test.mjs`
Expected: PASS — `public-lookup-page: all assertions passed`

- [ ] **Step 6: 部署公开页（5 个文件）**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/lookup.html root@<VPS_IPV4>:/opt/freemail-db-api/public/lookup.html
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/css/lookup.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/lookup.css
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/lookup.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/lookup.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/core/sanitize.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/core/sanitize.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/mailbox/email-detail.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/mailbox/email-detail.js
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/lookup.html /opt/freemail-db-api/public/css/lookup.css /opt/freemail-db-api/public/js/lookup.js /opt/freemail-db-api/public/js/core/sanitize.js /opt/freemail-db-api/public/js/modules/mailbox/email-detail.js"
md5sum public/lookup.html public/css/lookup.css public/js/lookup.js public/js/core/sanitize.js public/js/modules/mailbox/email-detail.js
for p in lookup.html css/lookup.css js/lookup.js js/core/sanitize.js js/modules/mailbox/email-detail.js; do curl -s -o /dev/null -w "$p:%{http_code} " "http://<VPS_IPV4>:18080/$p"; done; echo
```

Expected: 5 个文件 md5 一致；HTTP 全部 200。

- [ ] **Step 7: 浏览器验证公开页加载**

创建 `/tmp/opencode/mobile-check/verify-lookup-page.mjs`：

```js
import { firefox } from '/usr/lib/node_modules/openclaw/node_modules/playwright-core/index.mjs';

const base = 'http://<VPS_IPV4>:18080';
const browser = await firefox.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/firefox-1543/firefox/firefox' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(base + '/lookup.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('#access-code-input', { timeout: 20000 });
const maxlength = await page.getAttribute('#access-code-input', 'maxlength');
if (maxlength !== '8') throw new Error('input maxlength should be 8');
console.log('title:', (await page.textContent('h1')).trim());
console.log('lookup page OK');
await browser.close();
```

Run: `node /tmp/opencode/mobile-check/verify-lookup-page.mjs`
Expected: `lookup page OK`（查询功能在 Task 5 的完整 E2E 中验证）。

---

### Task 4: 管理端展示访问码

**Files:**
- Modify: `public/html/app.html`、`public/js/modules/app/mailbox-actions.js`、`public/js/modules/app/mailbox-list.js`、`public/js/app.js`、`public/css/app.css`
- Test: `tests/access-code-ui.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `access_code`（create/generate 响应、列表、mailbox/info）
- Produces: 管理端当前邮箱区域与邮箱列表展示访问码，可点击复制

- [ ] **Step 1: 写失败测试**

新建 `tests/access-code-ui.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/html/app.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="access-code-text"'), 'app page must have access code text');
assert.ok(html.includes('id="copy-access-code"'), 'app page must have copy access code button');

const actions = fs.readFileSync(new URL('../public/js/modules/app/mailbox-actions.js', import.meta.url), 'utf8');
assert.ok(actions.includes('setAccessCode'), 'mailbox actions must set access code');
assert.ok(actions.includes('access_code'), 'mailbox actions must read access_code');

const list = fs.readFileSync(new URL('../public/js/modules/app/mailbox-list.js', import.meta.url), 'utf8');
assert.ok(list.includes('access_code'), 'mailbox list must render access code');
assert.ok(list.includes('copyAccessCode'), 'mailbox list code must be copyable');

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(app.includes('window.copyAccessCode'), 'app.js must expose copyAccessCode');

console.log('access-code-ui: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/access-code-ui.test.mjs`
Expected: FAIL — `app page must have access code text`

- [ ] **Step 3: 实现管理端展示**

编辑 A：`public/html/app.html` 在 `#email` 的 `</div>` 之后、`.mailbox-display-content` 的 `</div>` 之前插入：

```html
              <div id="access-code-row" class="access-code-row" style="display:none">
                <span class="access-code-label">访问码</span>
                <code id="access-code-text" class="access-code-text"></code>
                <button id="copy-access-code" class="btn btn-ghost btn-sm" type="button">复制</button>
              </div>
```

编辑 B：`public/js/app.js`

在元素引用区（`els.domainAddInput = ...` 附近）新增：

```js
els.accessCodeRow = document.getElementById('access-code-row');
els.accessCodeText = document.getElementById('access-code-text');
els.copyAccessCode = document.getElementById('copy-access-code');
```

在全局函数区新增：

```js
window.copyAccessCode = async (code) => {
  const value = String(code || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast('访问码已复制', 'success');
  } catch (_) {
    showToast('复制失败，请手动复制', 'warn');
  }
};
```

在事件绑定区新增：

```js
if (els.copyAccessCode) els.copyAccessCode.onclick = () => {
  window.copyAccessCode(els.accessCodeText?.textContent || '');
};
```

编辑 C：`public/js/modules/app/mailbox-actions.js`

新增辅助函数：

```js
function setAccessCode(elements, code) {
  const row = elements?.accessCodeRow;
  const text = elements?.accessCodeText;
  if (!row || !text) return;
  const value = String(code || '').trim();
  text.textContent = value;
  row.style.display = value ? 'flex' : 'none';
}
```

在 `generateMailbox`、`generateNameMailbox`、`createCustomMailbox` 中，每次 `updateEmailDisplay(elements, data.email);` 之后加：

```js
    setAccessCode(elements, data.access_code);
```

在 `selectMailboxAddress` 的 `updateMailboxInfoUI(info);` 之后加：

```js
      setAccessCode(elements, info.access_code);
```

编辑 D：`public/js/modules/app/mailbox-list.js` 的 `renderMailboxItem` 中，在 `const pinIcon = ...` 后新增：

```js
  const accessCode = m.access_code
    ? `<span class="mailbox-access-code" onclick="event.stopPropagation();copyAccessCode('${escapeAttr(m.access_code)}')" title="点击复制访问码">#${escapeHtml(m.access_code)}</span>`
    : '';
```

并在模板中 `<span class="address">${displayAddress}</span>` 之后插入 `${accessCode}`。

编辑 E：`public/css/app.css` 末尾新增：

```css
.access-code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}

.access-code-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 6px;
}

.mailbox-access-code {
  display: inline-block;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/access-code-ui.test.mjs`
Expected: PASS

- [ ] **Step 5: 部署管理端（5 个文件）**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/html/app.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/app.html
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/app.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/app.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/app/mailbox-actions.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/mailbox-actions.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/app/mailbox-list.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/mailbox-list.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/css/app.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/app.css
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/html/app.html /opt/freemail-db-api/public/js/app.js /opt/freemail-db-api/public/js/modules/app/mailbox-actions.js /opt/freemail-db-api/public/js/modules/app/mailbox-list.js /opt/freemail-db-api/public/css/app.css"
md5sum public/html/app.html public/js/app.js public/js/modules/app/mailbox-actions.js public/js/modules/app/mailbox-list.js public/css/app.css
```

Expected: 5 个文件 md5 一致。

- [ ] **Step 6: 浏览器验证访问码展示**

Playwright：登录 → 点击「随机生成邮箱」→ 断言 `#access-code-text` 文本匹配 `^[a-z0-9]{8}$`，且邮箱列表出现 `#` + 同一码；然后删除该测试邮箱。

Expected: 访问码在生成区与列表中都可见。

---

### Task 5: `/` 切换 + 跳转修正 + 最终 E2E

**Files:**
- Modify: `.remote-freemail-server.mjs`（`/` → `/lookup.html`）、`public/index.html`、`public/js/login.js`、`public/js/auth-guard.js`、`public/templates/loading.html`
- Test: `tests/default-page-redirects.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1–4 全部
- Produces: `/` 公开查询页；管理端 `/index.html`；登录/加载/鉴权跳转全部指向 `/index.html`

- [ ] **Step 1: 写失败测试**

新建 `tests/default-page-redirects.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes("pathname === '/' ? '/lookup.html' : pathname"), 'root must serve lookup.html');

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(!index.includes("redirect=/')"), 'index.html must not redirect to the public page');
assert.ok(index.includes("redirect=/index.html')"), 'index.html must redirect back to /index.html');

const login = fs.readFileSync(new URL('../public/js/login.js', import.meta.url), 'utf8');
assert.ok(login.includes("return t || '/index.html'"), 'login default target must be /index.html');
assert.ok(!login.includes("location.replace('/')"), 'login must not navigate to the public page');

const guard = fs.readFileSync(new URL('../public/js/auth-guard.js', import.meta.url), 'utf8');
assert.ok(!guard.includes("window.location.replace('/')"), 'auth guard must not navigate to the public page');
assert.ok(guard.includes("window.location.replace('/index.html')"), 'auth guard fallback must be /index.html');

const loading = fs.readFileSync(new URL('../public/templates/loading.html', import.meta.url), 'utf8');
assert.ok(!loading.includes("location.replace('/')"), 'loading fallback must not navigate to the public page');
assert.ok(loading.includes("location.replace('/index.html')"), 'loading fallback must be /index.html');

console.log('default-page-redirects: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/default-page-redirects.test.mjs`
Expected: FAIL — `root must serve lookup.html`

- [ ] **Step 3: 实现路由与跳转修正**

编辑 A：`.remote-freemail-server.mjs` 的 `serveStaticFile`：

```js
    const safePath = pathname === '/' ? '/index.html' : pathname;
```

改为：

```js
    const safePath = pathname === '/' ? '/lookup.html' : pathname;
```

编辑 B：`public/index.html` 中 3 处 `redirect=/` 改为 `redirect=/index.html`。

编辑 C：`public/js/login.js`

```js
      try{ const u=new URL(location.href); const t=(u.searchParams.get('redirect')||'').trim(); return t || '/'; }catch(_){ return '/'; }
```

改为：

```js
      try{ const u=new URL(location.href); const t=(u.searchParams.get('redirect')||'').trim(); return t || '/index.html'; }catch(_){ return '/index.html'; }
```

并将：

```js
        } else if (target === '/' && (result.role === 'admin' || result.role === 'guest')) {
          // 管理员和访客跳转到主页
          finalTarget = '/';
        }
```

改为：

```js
        } else if ((target === '/' || target === '/index.html') && (result.role === 'admin' || result.role === 'guest')) {
          // 管理员和访客跳转到管理端主页
          finalTarget = '/index.html';
        }
```

编辑 D：`public/js/auth-guard.js` 中 2 处 `window.location.replace('/')` 改为 `window.location.replace('/index.html')`。

编辑 E：`public/templates/loading.html` 中 `location.replace('/')` 改为 `location.replace('/index.html')`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/default-page-redirects.test.mjs && node --check .remote-freemail-server.mjs`
Expected: PASS

- [ ] **Step 5: 部署后端与 4 个前端文件**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no .remote-freemail-server.mjs root@<VPS_IPV4>:/opt/freemail-db-api/server.mjs
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/index.html root@<VPS_IPV4>:/opt/freemail-db-api/public/index.html
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/login.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/login.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/auth-guard.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/auth-guard.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/templates/loading.html root@<VPS_IPV4>:/opt/freemail-db-api/public/templates/loading.html
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/server.mjs /opt/freemail-db-api/public/index.html /opt/freemail-db-api/public/js/login.js /opt/freemail-db-api/public/js/auth-guard.js /opt/freemail-db-api/public/templates/loading.html && systemctl restart freemail-db-api && sleep 6 && systemctl is-active freemail-db-api"
md5sum .remote-freemail-server.mjs public/index.html public/js/login.js public/js/auth-guard.js public/templates/loading.html
```

Expected: 5 个文件 md5 一致；`active`。

- [ ] **Step 6: 最终 E2E**

先创建测试邮箱、发送测试邮件，并生成本地参数文件：

```bash
OUT=$(ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<'EOF'
set -e
curl -s -c /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' >/dev/null
TS=$(date +%s)
LOCAL="e2elookup$TS"
RESP=$(curl -s -b /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/create -H 'Content-Type: application/json' -d "{\"local\":\"$LOCAL\",\"domain\":\"example.com\",\"subdomainLevels\":0}")
CODE=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_code||''))")
ADDR="$LOCAL@example.com"
python3 - "$ADDR" <<'PY'
import sys, smtplib
from email.mime.text import MIMEText
addr = sys.argv[1]
body = "Hello from the public lookup E2E.\n\nYour verification code is 24681357\n"
msg = MIMEText(body, 'plain', 'utf-8')
msg['Subject'] = 'E2E public lookup test'
msg['From'] = 'noreply@example.com'
msg['To'] = addr
s = smtplib.SMTP('127.0.0.1', 25, timeout=30)
s.sendmail('noreply@example.com', [addr], msg.as_string())
s.quit()
print('sent')
PY
sleep 3
echo "$CODE $ADDR $LOCAL"
rm -f /tmp/fmck.txt
EOF
)
echo "$OUT"
CODE=$(echo "$OUT" | tail -1 | awk '{print $1}')
ADDR=$(echo "$OUT" | tail -1 | awk '{print $2}')
LOCAL=$(echo "$OUT" | tail -1 | awk '{print $3}')
printf '{"code":"%s","address":"%s","local":"%s"}\n' "$CODE" "$ADDR" "$LOCAL" > /tmp/opencode/lookup-e2e.json
cat /tmp/opencode/lookup-e2e.json
```

Expected: 输出 `sent`，最后一行 `CODE ADDR LOCAL`，`CODE` 为 8 位 `[a-z0-9]`。

运行浏览器 E2E（脚本 `/tmp/opencode/mobile-check/verify-public-lookup.mjs`）：

```js
import fs from 'node:fs';
import { firefox } from '/usr/lib/node_modules/openclaw/node_modules/playwright-core/index.mjs';

const base = 'http://<VPS_IPV4>:18080';
const params = JSON.parse(fs.readFileSync('/tmp/opencode/lookup-e2e.json', 'utf8'));
const browser = await firefox.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/firefox-1543/firefox/firefox' });

// 匿名：/ 必须是公开页
const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await anon.newPage();
await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('#access-code-input', { timeout: 20000 });
console.log('anonymous / -> lookup page OK');

await page.fill('#access-code-input', params.code.toUpperCase());
await page.click('#lookup-btn');
await page.waitForSelector('#lookup-result:not([hidden])', { timeout: 20000 });
const address = (await page.textContent('#lookup-address')).trim();
console.log('lookup address:', address);
if (address !== params.address) throw new Error('address mismatch: ' + address);

await page.waitForSelector('.lookup-email-item', { timeout: 20000 });
const subject = (await page.textContent('.lookup-email-item .lookup-email-subject')).trim();
console.log('email subject:', subject);
if (subject !== 'E2E public lookup test') throw new Error('subject mismatch: ' + subject);

await page.click('.lookup-email-item');
await page.waitForSelector('#lookup-detail:not([hidden])', { timeout: 20000 });
const detail = (await page.textContent('#lookup-detail-body')).trim();
console.log('detail contains code:', detail.includes('24681357'));
if (!detail.includes('24681357')) throw new Error('detail missing content');

// 匿名访问管理 API 必须 401
const status = await page.evaluate(() => fetch('/api/mailboxes').then((r) => r.status));
console.log('anonymous /api/mailboxes status:', status);
if (status !== 401) throw new Error('anonymous API must be 401');

// 管理员登录后进入 /index.html；/ 仍是公开页
const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const adminPage = await admin.newPage();
await adminPage.goto(base + '/html/login.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
await adminPage.waitForTimeout(1500);
await adminPage.fill('#username', 'admin');
await adminPage.fill('#pwd', '<ADMIN_PASSWORD>');
await adminPage.click('#login');
await adminPage.waitForTimeout(6000);
console.log('admin url after login:', adminPage.url());
if (!adminPage.url().includes('/index.html')) throw new Error('admin should land on /index.html');
await adminPage.waitForSelector('#gen', { timeout: 20000 });
await adminPage.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await adminPage.waitForSelector('#access-code-input', { timeout: 20000 });
console.log('/ for logged-in admin is still the public page OK');

console.log('E2E OK');
await browser.close();
```

Run: `node /tmp/opencode/mobile-check/verify-public-lookup.mjs`
Expected: 匿名 `/` 显示公开页；查询返回正确地址/邮件/正文；匿名 API 401；管理员登录落到 `/index.html`；`/` 仍是公开页；`E2E OK`。

最后清理测试邮箱：

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<EOF
set -e
curl -s -c /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' >/dev/null
curl -s -b /tmp/fmck.txt -X DELETE "http://127.0.0.1:18080/api/mailboxes?address=$ADDR"; echo
rm -f /tmp/fmck.txt
EOF
```

Expected: `{"success":true,"deleted":true}`。
