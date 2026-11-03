# 批量添加域名区分“新增/已存在跳过” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批量添加域名时，toast 汇总区分“新增 X 个 / 已存在跳过 Y 个 / 失败 Z 个”。

**Architecture:** 后端 `POST /api/domains` 用 `INSERT ... ON CONFLICT DO NOTHING RETURNING domain` + `rowCount` 判断是否新增，响应新增 `created` 布尔字段（向后兼容）；前端批量处理器读取 `created` 统计三类计数并按规则拼接 toast。

**Tech Stack:** Node.js（无框架 http 服务 + pg）、原生 ES Module 前端、Node `assert` 静态测试、Playwright（Firefox）E2E。

## Global Constraints

- 用户处于 no-commit 模式：**不执行任何 git commit**；每个任务以“部署到 VPS + 验证”代替提交步骤。
- 部署目标：`ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4>`。
- 后端 live 路径 `/opt/freemail-db-api/server.mjs`，服务名 `freemail-db-api`，重启命令 `systemctl restart freemail-db-api`。
- 前端 live 路径 `/opt/freemail-db-api/public/js/app.js`（静态文件，无需重启）。
- 部署后必须 md5 一致；后端重启后 `systemctl is-active freemail-db-api` 为 `active`。
- Toast 文案为中文，逐字与 spec 一致：`新增 X 个`、`已存在跳过 Y 个`、`失败 Z 个`、`已存在跳过 Y 个（域名均已存在）`、`添加失败 Z 个`。
- 响应保持原有 `success`/`domain` 字段不变，只新增 `created`。
- 登录接口：`POST /api/login`，body `{"username":"admin","password":"<ADMIN_PASSWORD>"}`，Cookie 名 `iding-session`。

---

### Task 1: 后端 POST /api/domains 返回 created

**Files:**
- Modify: `.remote-freemail-server.mjs:378-399`
- Test: `tests/batch-domain-skip.test.mjs`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `POST /api/domains` 响应 `{ success: true, domain: string, created: boolean }`；`created=true` 表示本次新增，`false` 表示已存在被跳过。

- [ ] **Step 1: 写失败测试**

新建 `tests/batch-domain-skip.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(
  server.includes('ON CONFLICT (domain) DO NOTHING RETURNING domain'),
  'POST /api/domains must use RETURNING to detect existing domains'
);
assert.ok(
  server.includes('created: result.rowCount > 0'),
  'POST /api/domains must return created flag based on rowCount'
);

console.log('batch-domain-skip (backend): all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/batch-domain-skip.test.mjs`
Expected: FAIL — `must use RETURNING to detect existing domains`

- [ ] **Step 3: 实现后端改动**

`.remote-freemail-server.mjs` 中 `POST /api/domains` 处理器，将：

```js
        await pool.query('INSERT INTO domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING', [domain]);
        send(res, 200, { success: true, domain });
```

替换为：

```js
        const result = await pool.query(
          'INSERT INTO domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING domain',
          [domain]
        );
        send(res, 200, { success: true, domain, created: result.rowCount > 0 });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/batch-domain-skip.test.mjs`
Expected: PASS — `batch-domain-skip (backend): all assertions passed`

- [ ] **Step 5: 部署后端并重启**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no .remote-freemail-server.mjs root@<VPS_IPV4>:/opt/freemail-db-api/server.mjs
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/server.mjs && systemctl restart freemail-db-api && sleep 1 && systemctl is-active freemail-db-api && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/"
```

Expected: 远端 md5 与本机 `md5sum .remote-freemail-server.mjs` 一致；`active`；`200`。

- [ ] **Step 6: curl 验证 created 行为**

```bash
curl -s -c /tmp/opencode/fm-cookies.txt -X POST http://<VPS_IPV4>:18080/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'
```

Expected: `{"success":true,...}`

取一个已存在域名（从列表挑第一个；`GET /api/domains` 返回字符串数组）：

```bash
EXISTING=$(curl -s -b /tmp/opencode/fm-cookies.txt http://<VPS_IPV4>:18080/api/domains | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[0]))")
echo "existing=$EXISTING"
curl -s -b /tmp/opencode/fm-cookies.txt -X POST http://<VPS_IPV4>:18080/api/domains \
  -H 'Content-Type: application/json' -d "{\"domain\":\"$EXISTING\"}"
```

Expected: `{"success":true,"domain":"<EXISTING>","created":false}`

新域名验证后清理：

```bash
TESTDOMAIN="skip-test-$(date +%s).example.com"
curl -s -b /tmp/opencode/fm-cookies.txt -X POST http://<VPS_IPV4>:18080/api/domains \
  -H 'Content-Type: application/json' -d "{\"domain\":\"$TESTDOMAIN\"}"
```

Expected: `{"success":true,"domain":"skip-test-....example.com","created":true}`

```bash
curl -s -b /tmp/opencode/fm-cookies.txt -X DELETE "http://<VPS_IPV4>:18080/api/domains/$TESTDOMAIN"
```

Expected: `{"success":true,"domain":"skip-test-....example.com"}`

---

### Task 2: 前端统计与 toast 汇总

**Files:**
- Modify: `public/js/app.js:193-223`
- Modify: `tests/batch-domain-add-parse.test.mjs:19-20`
- Test: `tests/batch-domain-skip.test.mjs`（追加前端断言）

**Interfaces:**
- Consumes: Task 1 的响应字段 `created: boolean`
- Produces: 无（终端用户可见的 toast 行为）

- [ ] **Step 1: 更新旧测试并追加前端断言（先失败）**

`tests/batch-domain-add-parse.test.mjs` 第 19-20 行：

```js
assert.ok(source.includes('successCount'), 'domain add handler should report batch success count');
assert.ok(source.includes('failedCount'), 'domain add handler should report batch failure count');
```

改为：

```js
assert.ok(source.includes('createdCount'), 'domain add handler should report created count');
assert.ok(source.includes('failedCount'), 'domain add handler should report batch failure count');
```

`tests/batch-domain-skip.test.mjs` 末尾追加：

```js
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(app.includes('createdCount'), 'batch add must count newly created domains');
assert.ok(app.includes('skippedCount'), 'batch add must count skipped existing domains');
assert.ok(app.includes('data.created'), 'batch add must read created flag from response');

console.log('batch-domain-skip (frontend): all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/batch-domain-add-parse.test.mjs && node tests/batch-domain-skip.test.mjs`
Expected: 第一个 FAIL（找不到 `createdCount`），或第二个 FAIL（`data.created` 不存在）。

- [ ] **Step 3: 实现前端改动**

`public/js/app.js` 中 `if (els.domainAddBtn) els.domainAddBtn.onclick = ...` 整个处理器（193-223 行）替换为：

```js
if (els.domainAddBtn) els.domainAddBtn.onclick = async () => {
  const domainsToAdd = Array.from(new Set(
    String(els.domainAddInput?.value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
  if (!domainsToAdd.length) return showToast('请输入域名', 'warn');

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const domain of domainsToAdd) {
    try {
      const res = await api('/api/domains', { method: 'POST', body: JSON.stringify({ domain }) });
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      if (data.created) createdCount += 1;
      else skippedCount += 1;
    } catch (_) {
      failedCount += 1;
    }
  }

  if (createdCount > 0) {
    els.domainAddInput.value = '';
    await loadDomains(domainSelect, api);
  } else if (skippedCount > 0 && failedCount === 0) {
    els.domainAddInput.value = '';
  }

  if (createdCount === 0 && skippedCount > 0 && failedCount === 0) {
    showToast(`已存在跳过 ${skippedCount} 个（域名均已存在）`, 'warn');
    return;
  }
  if (createdCount === 0 && skippedCount === 0 && failedCount > 0) {
    showToast(`添加失败 ${failedCount} 个`, 'error');
    return;
  }

  const parts = [];
  if (createdCount > 0) parts.push(`新增 ${createdCount} 个`);
  if (skippedCount > 0) parts.push(`已存在跳过 ${skippedCount} 个`);
  if (failedCount > 0) parts.push(`失败 ${failedCount} 个`);
  showToast(parts.join('，'), failedCount > 0 ? 'warn' : 'success');
};
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `for t in tests/*.test.mjs; do node "$t" >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"; done`
Expected: 全部 `PASS`（18 个旧测试 + 新增文件）。

- [ ] **Step 5: 部署前端**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/app.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/app.js
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/js/app.js"
md5sum public/js/app.js
curl -s -o /dev/null -w '%{http_code}\n' http://<VPS_IPV4>:18080/js/app.js
```

Expected: 两端 md5 一致；`200`。

- [ ] **Step 6: 浏览器 E2E 验证 toast**

脚本 `/tmp/opencode/mobile-check/verify-domain-skip.mjs`：

```js
import { firefox } from '/usr/lib/node_modules/openclaw/node_modules/playwright-core/index.mjs';

const base = 'http://<VPS_IPV4>:18080';
const browser = await firefox.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/firefox-1543/firefox/firefox' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(base + '/html/login.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(1500);
await page.fill('#username', 'admin');
await page.fill('#pwd', '<ADMIN_PASSWORD>');
await page.click('#login');
await page.waitForTimeout(6000);

const domains = await page.evaluate(() => fetch('/api/domains').then(r => r.json()));
const existing = domains[0];
const testDomain = 'ui-skip-' + Date.now() + '.example.com';

await page.waitForSelector('#domain-add-input', { timeout: 20000 });
await page.fill('#domain-add-input', existing + ',' + testDomain);
await page.click('#domain-add-btn');
await page.waitForFunction(
  () => [...document.querySelectorAll('.toast-message')].some(e => e.textContent.includes('已存在跳过')),
  { timeout: 20000 }
);
const toast = await page.evaluate(
  () => [...document.querySelectorAll('.toast-message')].map(e => e.textContent).find(t => t.includes('已存在跳过'))
);
console.log('toast:', toast);
if (toast !== '新增 1 个，已存在跳过 1 个') throw new Error('unexpected toast: ' + toast);

await page.evaluate((d) => fetch('/api/domains/' + encodeURIComponent(d), { method: 'DELETE' }), testDomain);
console.log('E2E OK');
await browser.close();
```

Run: `node /tmp/opencode/mobile-check/verify-domain-skip.mjs`
Expected: `toast: 新增 1 个，已存在跳过 1 个` 和 `E2E OK`（脚本已自动删除测试域名）。
