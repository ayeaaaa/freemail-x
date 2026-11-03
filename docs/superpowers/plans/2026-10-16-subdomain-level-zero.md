# 随机子域支持 0 级（根域名）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `subdomainLevels` 支持 `0`（不加子域、直接用根域名），三个创建入口（随机生成 / 随机人名 / 自定义）行为一致，下拉默认 `0 级（根域名）`。

**Architecture:** 后端新增共享助手 `buildAddressHost(domain, levels)`（0 → 根域名，1–7 → N 级随机子域），`/api/generate` 与 `/api/create` 统一使用；前端下拉新增 0 级选项并默认选中，`getSubdomainLevels` clamp 改为 0–7；guest mock 同步遵守该参数。

**Tech Stack:** Node.js（无框架 http 服务 + pg）、原生 ES Module 前端、Node `assert` 静态测试、Playwright（Firefox）E2E。

## Global Constraints

- 用户处于 no-commit 模式：**不执行任何 git commit**；每个任务以“部署到 VPS + 验证”代替提交步骤。
- 部署目标：`ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4>`。
- 后端 live 路径 `/opt/freemail-db-api/server.mjs`，服务名 `freemail-db-api`，重启 `systemctl restart freemail-db-api`。
- 前端 live 路径前缀 `/opt/freemail-db-api/public/`（静态文件，无需重启）。
- 部署后必须 md5 一致；后端重启后 `systemctl is-active freemail-db-api` 为 `active`。
- 语义：`subdomainLevels = 0` → `local@根域名`；`N`（1–7）→ `local@` + N 个 6 位随机标签（`[a-z0-9]`）以 `.` 连接 + `.根域名`；越界 clamp 到 0–7。
- `/api/create` 带完整 `email` 字段时原样使用，不叠加子域。
- 登录接口：`POST /api/login`，body `{"username":"admin","password":"<ADMIN_PASSWORD>"}`，Cookie 名 `iding-session`。
- 验证用域名：`example.com`（已存在于域名列表）；测试邮箱验证后必须删除：`DELETE /api/mailboxes?address=<email>`。

---

### Task 1: 后端支持 0 级（buildAddressHost + 两个端点）

**Files:**
- Modify: `.remote-freemail-server.mjs`（`buildRandomSubdomain` 后新增助手；`/api/generate` 约 476–478 行；`/api/create` 约 437–448 行）
- Test: `tests/subdomain-level.test.mjs`（新建，本任务只写后端断言）

**Interfaces:**
- Consumes: 无
- Produces:
  - `buildAddressHost(domain, levels)`：返回主机名（含域）；`levels=0` 时返回 `domain` 本身
  - `GET/POST /api/generate?...&subdomainLevels=N`：`N=0` → `local@domain`；`N≥1` → `local@<N 个随机标签>.domain`
  - `POST /api/create {local, domain, subdomainLevels}`：同上；带 `email` 字段时原样使用

- [ ] **Step 1: 写失败测试（后端断言）**

新建 `tests/subdomain-level.test.mjs`：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes('function buildAddressHost(domain, levels)'), 'backend must define buildAddressHost');
assert.ok(server.includes('Math.max(0, Math.min(7, Number(levels) || 0))'), 'buildAddressHost must clamp 0..7');
assert.ok(server.includes('buildAddressHost(domain, subdomainLevels)'), '/api/generate must use buildAddressHost');
assert.ok(server.includes('buildAddressHost(domain, data.subdomainLevels)'), '/api/create must use buildAddressHost');
assert.ok(!server.includes('Math.max(1, Math.min(7, Number(data.subdomainLevels'), 'old 1..7 clamp must be removed from /api/generate');

console.log('subdomain-level (backend): all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/subdomain-level.test.mjs`
Expected: FAIL — `backend must define buildAddressHost`

- [ ] **Step 3: 实现后端改动（三处编辑）**

编辑 A：在 `buildRandomSubdomain` 函数之后新增助手：

```js
function buildAddressHost(domain, levels) {
  const count = Math.max(0, Math.min(7, Number(levels) || 0));
  return count > 0 ? `${buildRandomSubdomain(count)}.${domain}` : domain;
}
```

编辑 B：`/api/generate` 中，将：

```js
        const subdomainLevels = Math.max(1, Math.min(7, Number(data.subdomainLevels || url.searchParams.get('subdomainLevels') || 1) || 1));
        const local = generateRandomId(length);
        const address = `${local}@${buildRandomSubdomain(subdomainLevels)}.${domain}`;
```

替换为：

```js
        const rawLevels = data.subdomainLevels ?? url.searchParams.get('subdomainLevels');
        const subdomainLevels = Math.max(0, Math.min(7, Number(rawLevels ?? 0) || 0));
        const local = generateRandomId(length);
        const address = `${local}@${buildAddressHost(domain, subdomainLevels)}`;
```

编辑 C：`/api/create` 中，将：

```js
        if (fullEmail) {
          const at = fullEmail.indexOf('@');
          if (at > 0 && at < fullEmail.length - 1) {
            local = fullEmail.slice(0, at);
            domain = fullEmail.slice(at + 1);
          }
        }
        if (!local || !domain) {
          send(res, 400, { error: 'invalid_mailbox' });
          return;
        }
        const address = `${local}@${domain}`;
```

替换为：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/subdomain-level.test.mjs`
Expected: PASS — `subdomain-level (backend): all assertions passed`

- [ ] **Step 5: 部署后端并重启**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no .remote-freemail-server.mjs root@<VPS_IPV4>:/opt/freemail-db-api/server.mjs
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/server.mjs && systemctl restart freemail-db-api && sleep 1 && systemctl is-active freemail-db-api && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/"
md5sum .remote-freemail-server.mjs
```

Expected: 两端 md5 一致；`active`；`200`。

- [ ] **Step 6: curl 验证 0 级与 2 级（含清理）**

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> 'bash -s' <<'EOF'
set -e
jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).email))"; }
curl -s -c /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' >/dev/null
D=example.com
echo "-- generate level 0:"
E0=$(curl -s -b /tmp/fmck.txt "http://127.0.0.1:18080/api/generate?length=8&domain=$D&subdomainLevels=0" | jget)
echo "$E0"
echo "$E0" | grep -qE '^[a-z0-9]{8}@ffaaffai\.asia$' && echo OK-GEN-0
echo "-- generate level 2:"
E2=$(curl -s -b /tmp/fmck.txt "http://127.0.0.1:18080/api/generate?length=8&domain=$D&subdomainLevels=2" | jget)
echo "$E2"
echo "$E2" | grep -qE '^[a-z0-9]{8}@[a-z0-9]{6}\.[a-z0-9]{6}\.ffaaffai\.asia$' && echo OK-GEN-2
echo "-- create level 0:"
C0=$(curl -s -b /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/create -H 'Content-Type: application/json' -d '{"local":"zsqtest0","domain":"example.com","subdomainLevels":0}' | jget)
echo "$C0"
[ "$C0" = "zsqtest0@example.com" ] && echo OK-CREATE-0
echo "-- create level 2:"
C2=$(curl -s -b /tmp/fmck.txt -X POST http://127.0.0.1:18080/api/create -H 'Content-Type: application/json' -d '{"local":"zsqtest2","domain":"example.com","subdomainLevels":2}' | jget)
echo "$C2"
echo "$C2" | grep -qE '^zsqtest2@[a-z0-9]{6}\.[a-z0-9]{6}\.ffaaffai\.asia$' && echo OK-CREATE-2
echo "-- cleanup:"
for A in "$E0" "$E2" "$C0" "$C2"; do curl -s -b /tmp/fmck.txt -X DELETE "http://127.0.0.1:18080/api/mailboxes?address=$A"; echo; done
rm -f /tmp/fmck.txt
EOF
```

Expected: 输出含 `OK-GEN-0`、`OK-GEN-2`、`OK-CREATE-0`、`OK-CREATE-2`，清理 DELETE 均返回 `{"success":true,...}`。

---

### Task 2: 前端下拉 0 级 + guest mock 一致

**Files:**
- Modify: `public/html/app.html:239-247`（`#subdomain-level-select`）
- Modify: `public/js/modules/app/mailbox-actions.js:30-32`（`getSubdomainLevels`）
- Modify: `public/js/modules/app/mock-api.js`（`/api/generate` 约 154–159 行；`/api/create` 约 275–277 行）
- Test: `tests/subdomain-level.test.mjs`（追加前端断言）

**Interfaces:**
- Consumes: Task 1 的后端行为（`subdomainLevels` 0–7）
- Produces: 无（终端用户可见的下拉与生成行为）

- [ ] **Step 1: 追加前端断言（先失败）**

`tests/subdomain-level.test.mjs` 末尾追加：

```js
const actions = fs.readFileSync(new URL('../public/js/modules/app/mailbox-actions.js', import.meta.url), 'utf8');
assert.ok(actions.includes('Math.max(0, Math.min(7'), 'getSubdomainLevels must clamp 0..7');
assert.ok(!actions.includes('Number(elements?.subdomainLevelSelect?.value || 3) || 3'), 'old 3-level default must be removed');

const html = fs.readFileSync(new URL('../public/html/app.html', import.meta.url), 'utf8');
assert.ok(html.includes('<option value="0" selected>0 级（根域名）</option>'), 'level select must default to 0 级（根域名）');

const mock = fs.readFileSync(new URL('../public/js/modules/app/mock-api.js', import.meta.url), 'utf8');
assert.ok((mock.match(/subdomainLevels/g) || []).length >= 2, 'mock /api/generate and /api/create must read subdomainLevels');

console.log('subdomain-level (frontend): all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/subdomain-level.test.mjs`
Expected: FAIL — `getSubdomainLevels must clamp 0..7`

- [ ] **Step 3: 实现前端改动（三处编辑）**

编辑 A：`public/html/app.html` 中，将：

```html
                <select id="subdomain-level-select" class="select config-select" aria-label="选择随机子域层级">
                  <option value="1">1 级</option>
                  <option value="2">2 级</option>
                  <option value="3" selected>3 级</option>
                  <option value="4">4 级</option>
                  <option value="5">5 级</option>
                  <option value="6">6 级</option>
                  <option value="7">7 级</option>
                </select>
```

替换为：

```html
                <select id="subdomain-level-select" class="select config-select" aria-label="选择随机子域层级">
                  <option value="0" selected>0 级（根域名）</option>
                  <option value="1">1 级</option>
                  <option value="2">2 级</option>
                  <option value="3">3 级</option>
                  <option value="4">4 级</option>
                  <option value="5">5 级</option>
                  <option value="6">6 级</option>
                  <option value="7">7 级</option>
                </select>
```

编辑 B：`public/js/modules/app/mailbox-actions.js` 中，将：

```js
function getSubdomainLevels(elements) {
  return Math.max(1, Math.min(7, Number(elements?.subdomainLevelSelect?.value || 3) || 3));
}
```

替换为：

```js
function getSubdomainLevels(elements) {
  return Math.max(0, Math.min(7, Number(elements?.subdomainLevelSelect?.value ?? 0) || 0));
}
```

编辑 C：`public/js/modules/app/mock-api.js`

`/api/generate` 分支中，将：

```js
    const domain = MOCK_STATE.domains[Number(url.searchParams.get('domainIndex') || 0)] || 'example.com';
    const email = `${id}@${domain}`;
```

替换为：

```js
    const domain = MOCK_STATE.domains[Number(url.searchParams.get('domainIndex') || 0)] || 'example.com';
    const levels = Math.max(0, Math.min(7, Number(url.searchParams.get('subdomainLevels') ?? 0) || 0));
    const sub = Array.from({ length: levels }, () => mockGenerateId(6)).join('.');
    const email = `${id}@${sub ? sub + '.' : ''}${domain}`;
```

`/api/create` 分支中，将：

```js
      const domain = MOCK_STATE.domains[Math.max(0, Math.min(MOCK_STATE.domains.length - 1, domainIndex))] || 'example.com';
      const email = `${local}@${domain}`;
```

替换为：

```js
      const domain = MOCK_STATE.domains[Math.max(0, Math.min(MOCK_STATE.domains.length - 1, domainIndex))] || 'example.com';
      const levels = Math.max(0, Math.min(7, Number(body.subdomainLevels ?? 0) || 0));
      const sub = Array.from({ length: levels }, () => mockGenerateId(6)).join('.');
      const email = `${local}@${sub ? sub + '.' : ''}${domain}`;
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `for t in tests/*.test.mjs; do node "$t" >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"; done`
Expected: 全部 `PASS`（19 个旧测试 + `tests/subdomain-level.test.mjs`）。

- [ ] **Step 5: 部署前端（3 个文件）**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/html/app.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/app.html
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/app/mailbox-actions.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/mailbox-actions.js
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/app/mock-api.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/mock-api.js
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> -o StrictHostKeyChecking=no root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/html/app.html /opt/freemail-db-api/public/js/modules/app/mailbox-actions.js /opt/freemail-db-api/public/js/modules/app/mock-api.js"
md5sum public/html/app.html public/js/modules/app/mailbox-actions.js public/js/modules/app/mock-api.js
curl -s -o /dev/null -w 'app.html:%{http_code} ' http://<VPS_IPV4>:18080/html/app.html
curl -s -o /dev/null -w 'actions:%{http_code} ' http://<VPS_IPV4>:18080/js/modules/app/mailbox-actions.js
curl -s -o /dev/null -w 'mock:%{http_code}\n' http://<VPS_IPV4>:18080/js/modules/app/mock-api.js
```

Expected: 3 个文件两端 md5 一致；三个 URL 均 `200`。

- [ ] **Step 6: 浏览器 E2E 验证 0 级与 2 级**

脚本 `/tmp/opencode/mobile-check/verify-subdomain-zero.mjs`：

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
await page.waitForSelector('#subdomain-level-select', { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('#domain-select option').length > 0, { timeout: 20000 });

const defaultValue = await page.inputValue('#subdomain-level-select');
console.log('default level:', defaultValue);
if (defaultValue !== '0') throw new Error('default level should be 0');

const domain = (await page.evaluate(() => {
  const sel = document.getElementById('domain-select');
  return sel.options[sel.selectedIndex].textContent.trim();
}));
console.log('domain:', domain);
const rootRe = new RegExp('^[a-z0-9]{8}@' + domain.replace(/\./g, '\\.') + '$');
const subRe = new RegExp('^[a-z0-9]{8}@[a-z0-9]{6}\\.[a-z0-9]{6}\\.' + domain.replace(/\./g, '\\.') + '$');

const gen = async (prev) => {
  await page.click('#gen');
  await page.waitForFunction((p) => {
    const el = document.getElementById('email-text');
    return el && el.textContent.includes('@') && el.textContent.trim() !== p;
  }, prev, { timeout: 20000 });
  await page.waitForTimeout(500);
  return (await page.textContent('#email-text')).trim();
};

const email0 = await gen('');
console.log('level 0 ->', email0);
if (!rootRe.test(email0)) throw new Error('level 0 should be local@root-domain, got: ' + email0);

await page.selectOption('#subdomain-level-select', '2');
const email2 = await gen(email0);
console.log('level 2 ->', email2);
if (!subRe.test(email2)) throw new Error('level 2 should have 2 random labels, got: ' + email2);

for (const addr of [email0, email2]) {
  await page.evaluate((a) => fetch('/api/mailboxes?address=' + encodeURIComponent(a), { method: 'DELETE' }), addr);
}
console.log('E2E OK');
await browser.close();
```

Run: `node /tmp/opencode/mobile-check/verify-subdomain-zero.mjs`
Expected: `default level: 0`；`level 0 -> xxx@example.com`（无子域）；`level 2 -> xxx@xx.xx.example.com`；`E2E OK`（脚本自动删除两个测试邮箱）。
