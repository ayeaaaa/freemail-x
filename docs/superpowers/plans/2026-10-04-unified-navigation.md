# 统一导航 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全部页面使用同一套导航（首页 / 所有邮箱* / 用户管理* / 退出登录），任意页面可达任意页面，管理入口按角色显示，当前页高亮。

**Architecture:** 新增共享脚本 `public/js/nav.js`：请求一次 `/api/session`，按角色显示/隐藏 `[data-nav-admin]` 入口，高亮当前页面链接，用 MutationObserver 兼容主页面片段异步注入。各页面 HTML 静态替换为统一导航结构。旧的入口显隐逻辑从 `session.js` 移除。

**Tech Stack:** 原生浏览器 JS（无构建步骤），静态部署到 VPS。

## Global Constraints

- 不改后端与 API
- 不改各页面现有的退出按钮绑定逻辑（domain-migrate 页除外，它需要新增绑定）
- 页面权限守卫（admin.html / mailbox.html 鉴权脚本）不动
- 管理入口默认 `style="display:none"`，由 nav.js 按角色显示
- 角色规则与现有一致：`session.strictAdmin === true` 或 `session.role === 'guest'`
- 去掉 GitHub 链接、域名迁移链接（含 admin.html 内容区死链按钮）
- 不提交 git（no-commit 模式）
- 部署：`ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4>`，目录 `/opt/freemail-db-api/public/`

---

### Task 1: nav.js + 功能测试

**Files:**
- Create: `public/js/nav.js`
- Test: `tests/nav-js.test.mjs`

**Interfaces:**
- Produces: 全局脚本；DOM 契约：`[data-nav-admin]` 元素、`.nav-actions a[href]` 链接、`#logout` 按钮

- [ ] **Step 1: 写失败测试**

Create `tests/nav-js.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/js/nav.js', import.meta.url), 'utf8');

function makeAdminNode() {
  const classes = new Set();
  return {
    style: { display: 'none' },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }
  };
}

function makeLink(href) {
  const classes = new Set();
  return {
    style: {},
    getAttribute: (name) => (name === 'href' ? href : null),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }
  };
}

function run({ session, pathname = '/', sessionFails = false, adminNodes = [], links = [] }) {
  const documentMock = {
    readyState: 'complete',
    addEventListener: () => {},
    body: {},
    querySelector: (selector) => (selector === '[data-nav-admin]' ? (adminNodes[0] || null) : null),
    querySelectorAll: (selector) => {
      if (selector === '[data-nav-admin]') return adminNodes;
      if (selector === '.nav-actions a[href]') return links;
      return [];
    }
  };
  const windowMock = { location: { pathname }, MutationObserver: null };
  const fetchMock = () => sessionFails
    ? Promise.reject(new Error('network'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(session) });
  new Function('window', 'document', 'fetch', source)(windowMock, documentMock, fetchMock);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// strictAdmin → 管理入口显示
{
  const node = makeAdminNode();
  run({ session: { strictAdmin: true, role: 'admin' }, adminNodes: [node] });
  await tick();
  assert.equal(node.style.display, 'inline-flex', 'strictAdmin must show admin entries');
}

// guest → 管理入口显示
{
  const node = makeAdminNode();
  run({ session: { role: 'guest' }, adminNodes: [node] });
  await tick();
  assert.equal(node.style.display, 'inline-flex', 'guest must show admin entries');
}

// 普通 user → 管理入口隐藏
{
  const node = makeAdminNode();
  run({ session: { role: 'user' }, adminNodes: [node] });
  await tick();
  assert.equal(node.style.display, 'none', 'user must hide admin entries');
}

// 会话请求失败 → 保持隐藏（fail-closed）
{
  const node = makeAdminNode();
  run({ sessionFails: true, adminNodes: [node] });
  await tick();
  assert.equal(node.style.display, 'none', 'failed session must keep admin entries hidden');
}

// 当前页高亮
{
  const home = makeLink('/');
  const admin = makeLink('/html/admin.html');
  run({ session: { strictAdmin: true }, pathname: '/html/admin.html', links: [home, admin] });
  await tick();
  assert.ok(admin.classList.contains('is-active'), 'current page link must be active');
  assert.ok(!home.classList.contains('is-active'), 'other page link must not be active');
}

console.log('nav-js: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/nav-js.test.mjs`
Expected: FAIL with `ENOENT`（nav.js 不存在）

- [ ] **Step 3: 创建 nav.js**

Create `public/js/nav.js`:

```js
/* =============================================
   Freemail 统一导航
   - 按角色显示/隐藏管理入口（[data-nav-admin]）
   - 高亮当前页面入口（is-active）
   ============================================= */

(function () {
  var ADMIN_SELECTOR = '[data-nav-admin]';
  var sessionCache = null;
  var sessionLoaded = false;
  var observer = null;

  function isPrivileged(session) {
    return !!session && (session.strictAdmin === true || session.role === 'guest');
  }

  function applyVisibility(session) {
    var privileged = isPrivileged(session);
    var nodes = document.querySelectorAll(ADMIN_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = privileged ? 'inline-flex' : 'none';
    }
  }

  function currentPath() {
    var path = window.location.pathname || '/';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }
    return path;
  }

  function highlightCurrent() {
    var path = currentPath();
    var links = document.querySelectorAll('.nav-actions a[href]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href') || '';
      var linkPath = href.split('?')[0].split('#')[0];
      if (linkPath.length > 1 && linkPath.charAt(linkPath.length - 1) === '/') {
        linkPath = linkPath.slice(0, -1);
      }
      if (linkPath && linkPath === path) {
        link.classList.add('is-active');
      } else {
        link.classList.remove('is-active');
      }
    }
  }

  function applyAll(session) {
    applyVisibility(session);
    highlightCurrent();
  }

  function loadSession() {
    try {
      return fetch('/api/session', { headers: { 'Cache-Control': 'no-cache' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function init() {
    applyAll(null);
    loadSession().then(function (session) {
      sessionCache = session;
      sessionLoaded = true;
      applyAll(session);
    });
    if (window.MutationObserver) {
      observer = new window.MutationObserver(function () {
        if (document.querySelector(ADMIN_SELECTOR)) {
          applyAll(sessionLoaded ? sessionCache : null);
          if (sessionLoaded && observer) {
            observer.disconnect();
            observer = null;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/nav-js.test.mjs`
Expected: `nav-js: all assertions passed`

### Task 2: 统一 5 个页面的导航 HTML

**Files:**
- Modify: `public/html/app.html`（导航块，第 11-52 行）
- Modify: `public/html/admin.html`（导航块第 78-95 行；删除第 187 行附近死链按钮；脚本区加 nav.js）
- Modify: `public/html/mailboxes.html`（导航块第 53-79 行；脚本区加 nav.js）
- Modify: `public/html/mailbox.html`（导航块第 77-94 行；脚本区加 nav.js）
- Modify: `public/html/domain-migrate.html`（导航块第 55-58 行；脚本区加 nav.js + 退出绑定）
- Modify: `public/index.html`（脚本区第 261 行前加 nav.js）
- Test: `tests/nav-unified.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 nav.js
- Produces: 统一导航 DOM 契约（`data-nav-admin`、`#logout`、首页/所有邮箱/用户管理链接）

- [ ] **Step 1: 写失败测试**

Create `tests/nav-unified.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');

const navPages = ['html/app.html', 'html/admin.html', 'html/mailboxes.html', 'html/mailbox.html', 'html/domain-migrate.html'];
const scriptPages = ['index.html', 'html/admin.html', 'html/mailboxes.html', 'html/mailbox.html', 'html/domain-migrate.html'];

for (const page of scriptPages) {
  const html = read(page);
  assert.ok(html.includes('/js/nav.js'), page + ' must load nav.js');
}

for (const page of navPages) {
  const html = read(page);
  assert.ok(html.includes('href="/"'), page + ' must contain 首页 link');
  assert.ok(html.includes('/html/mailboxes.html'), page + ' must contain 所有邮箱 link');
  assert.ok(html.includes('/html/admin.html'), page + ' must contain 用户管理 link');
  assert.ok(html.includes('id="logout"'), page + ' must contain logout button');
  assert.ok(html.includes('data-nav-admin'), page + ' must mark admin entries');
  assert.ok(!html.includes('github.com'), page + ' must not contain GitHub links');
  assert.ok(!html.includes('asbarm02'), page + ' must not contain dead migrator links');
  assert.ok(!html.includes('18100'), page + ' must not contain dead migrator port');
}

const navJs = read('js/nav.js');
assert.ok(navJs.includes('strictAdmin'), 'nav.js must check strictAdmin');
assert.ok(navJs.includes("'guest'"), 'nav.js must check guest role');
assert.ok(navJs.includes('is-active'), 'nav.js must highlight current page');

console.log('nav-unified: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/nav-unified.test.mjs`
Expected: FAIL（页面缺少 nav.js、仍含 GitHub/死链）

- [ ] **Step 3: 替换 app.html 导航块**

将 `public/html/app.html` 第 11-52 行（整个 `<div class="nav-actions">...</div>`）替换为：

```html
  <div class="nav-actions">
    <a class="btn btn-ghost" href="/" title="首页">
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <use href="/icons/sprites.svg#icon-home"/>
        </svg>
      </span>
      <span class="btn-text">首页</span>
    </a>
    <a class="btn btn-ghost" data-nav-admin href="/html/mailboxes.html" title="所有邮箱" style="display:none">
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <use href="/icons/sprites.svg#icon-package"/>
        </svg>
      </span>
      <span class="btn-text">所有邮箱</span>
    </a>
    <a class="btn btn-ghost" data-nav-admin href="/html/admin.html" title="用户管理" style="display:none">
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <use href="/icons/sprites.svg#icon-wrench"/>
        </svg>
      </span>
      <span class="btn-text">用户管理</span>
    </a>
    <button id="logout" class="btn btn-secondary" title="退出登录">
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <use href="/icons/sprites.svg#icon-logout"/>
        </svg>
      </span>
      <span class="btn-text">退出登录</span>
    </button>
  </div>
```

- [ ] **Step 4: 替换 admin.html 导航块并清理死链**

将 `public/html/admin.html` 第 78-95 行（`<div class="nav-actions">...</div>`）替换为（保持该文件 6 空格缩进风格）：

```html
      <div class="nav-actions">
        <a class="btn btn-ghost" href="/" title="首页">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-home"/>
            </svg>
          </span>
          <span class="btn-text">首页</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/mailboxes.html" title="所有邮箱" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-package"/>
            </svg>
          </span>
          <span class="btn-text">所有邮箱</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/admin.html" title="用户管理" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-wrench"/>
            </svg>
          </span>
          <span class="btn-text">用户管理</span>
        </a>
        <button id="logout" class="btn btn-secondary" title="退出登录">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-logout"/>
            </svg>
          </span>
          <span class="btn-text">退出登录</span>
        </button>
      </div>
```

并删除 admin.html 第 187 行附近的死链按钮（`<a href="http://asbarm02...18100/">...迁移域名...</a>` 整个 a 标签）。

- [ ] **Step 5: 替换 mailboxes.html 导航块**

将 `public/html/mailboxes.html` 第 53-79 行（`<div class="nav-actions">...</div>`，含 spacer）替换为（8 空格缩进风格，无 spacer）：

```html
      <div class="nav-actions">
        <a class="btn btn-ghost" href="/" title="首页">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-home"/>
            </svg>
          </span>
          <span class="btn-text">首页</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/mailboxes.html" title="所有邮箱" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-package"/>
            </svg>
          </span>
          <span class="btn-text">所有邮箱</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/admin.html" title="用户管理" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-wrench"/>
            </svg>
          </span>
          <span class="btn-text">用户管理</span>
        </a>
        <button id="logout" class="btn btn-secondary" title="退出登录">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-logout"/>
            </svg>
          </span>
          <span class="btn-text">退出登录</span>
        </button>
      </div>
```

- [ ] **Step 6: 替换 mailbox.html 导航块**

将 `public/html/mailbox.html` 第 77-94 行（`<div class="nav-actions">...</div>`）替换为（4 空格缩进风格）：

```html
    <div class="nav-actions">
      <a class="btn btn-ghost" href="/" title="首页">
        <span class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <use href="/icons/sprites.svg#icon-home"/>
          </svg>
        </span>
        <span class="btn-text">首页</span>
      </a>
      <a class="btn btn-ghost" data-nav-admin href="/html/mailboxes.html" title="所有邮箱" style="display:none">
        <span class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <use href="/icons/sprites.svg#icon-package"/>
          </svg>
        </span>
        <span class="btn-text">所有邮箱</span>
      </a>
      <a class="btn btn-ghost" data-nav-admin href="/html/admin.html" title="用户管理" style="display:none">
        <span class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <use href="/icons/sprites.svg#icon-wrench"/>
          </svg>
        </span>
        <span class="btn-text">用户管理</span>
      </a>
      <button id="logout" class="btn btn-secondary" title="退出登录">
        <span class="btn-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <use href="/icons/sprites.svg#icon-logout"/>
          </svg>
        </span>
        <span class="btn-text">退出登录</span>
      </button>
    </div>
```

- [ ] **Step 7: 替换 domain-migrate.html 导航块并加脚本**

将 `public/html/domain-migrate.html` 第 55-58 行（`<div class="nav-actions">...</div>`）替换为（6 空格缩进风格）：

```html
      <div class="nav-actions">
        <a class="btn btn-ghost" href="/" title="首页">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-home"/>
            </svg>
          </span>
          <span class="btn-text">首页</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/mailboxes.html" title="所有邮箱" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-package"/>
            </svg>
          </span>
          <span class="btn-text">所有邮箱</span>
        </a>
        <a class="btn btn-ghost" data-nav-admin href="/html/admin.html" title="用户管理" style="display:none">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-wrench"/>
            </svg>
          </span>
          <span class="btn-text">用户管理</span>
        </a>
        <button id="logout" class="btn btn-secondary" title="退出登录">
          <span class="btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <use href="/icons/sprites.svg#icon-logout"/>
            </svg>
          </span>
          <span class="btn-text">退出登录</span>
        </button>
      </div>
```

将 domain-migrate.html 脚本区（`<script type="module" src="/js/domain-migrate.js"></script>` 与 `<script src="/js/theme.js"></script>` 之间）改为：

```html
    <script type="module" src="/js/domain-migrate.js"></script>
    <script src="/js/nav.js"></script>
    <script>
      document.getElementById('logout')?.addEventListener('click', async () => {
        try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
        location.replace('/html/login.html');
      });
    </script>
    <script src="/js/theme.js"></script>
```

- [ ] **Step 8: 其余页面脚本区加 nav.js**

在以下位置，将 `<script src="/js/theme.js"></script>` 之前插入 `<script src="/js/nav.js"></script>`：

```text
public/index.html 第 261 行前
public/html/admin.html 第 642 行前
public/html/mailboxes.html 第 454 行前
public/html/mailbox.html 第 246 行前
```

- [ ] **Step 9: 运行测试确认通过**

Run: `node tests/nav-unified.test.mjs`
Expected: `nav-unified: all assertions passed`

### Task 3: 移除旧显隐逻辑 + 高亮样式

**Files:**
- Modify: `public/js/modules/app/session.js`（删除第 80-91 行入口显隐块）
- Modify: `public/js/modules/app/ui-helpers.js`（删除第 178-190 行同款死代码块）
- Modify: `public/css/components.css`（追加 is-active 样式）

**Interfaces:**
- Consumes: Task 1/2 的 nav.js 契约
- Produces: 无新旧逻辑冲突；`.btn-ghost.is-active` 高亮样式

- [ ] **Step 1: 修改 session.js**

将 `public/js/modules/app/session.js` 中这段（约第 80-91 行）：

```js
    const adminLink = document.getElementById('admin');
    const allMailboxesLink = document.getElementById('all-mailboxes');
    const domainMigrateLink = document.getElementById('domain-migrate-link');
    
    if (session && (session.strictAdmin || session.role === 'guest')) {
      if (adminLink) adminLink.style.display = 'inline-flex';
      if (allMailboxesLink) allMailboxesLink.style.display = 'inline-flex';
      if (domainMigrateLink) domainMigrateLink.style.display = session.strictAdmin ? 'inline-flex' : 'none';
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (allMailboxesLink) allMailboxesLink.style.display = 'none';
      if (domainMigrateLink) domainMigrateLink.style.display = 'none';
    }
```

删除（保留前面的角色徽章逻辑和后面的 `} catch(_) {}`）。

- [ ] **Step 2: 修改 ui-helpers.js**

将 `public/js/modules/app/ui-helpers.js` 中这段（约第 178-190 行，同款死代码）：

```js
    const adminLink = document.getElementById('admin');
    const allMailboxesLink = document.getElementById('all-mailboxes');
    const domainMigrateLink = document.getElementById('domain-migrate-link');
    
    if (session && (session.strictAdmin || session.role === 'guest')) {
      if (adminLink) adminLink.style.display = 'inline-flex';
      if (allMailboxesLink) allMailboxesLink.style.display = 'inline-flex';
      if (domainMigrateLink) domainMigrateLink.style.display = session.strictAdmin ? 'inline-flex' : 'none';
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (allMailboxesLink) allMailboxesLink.style.display = 'none';
      if (domainMigrateLink) domainMigrateLink.style.display = 'none';
    }
```

删除（保留角色徽章逻辑与 `} catch (_) {}`）。

- [ ] **Step 3: 追加高亮样式**

在 `public/css/components.css` 末尾追加：

```css
/* ---------- 导航当前页高亮 ---------- */
.btn-ghost.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}
```

- [ ] **Step 4: 回归测试**

Run: `node tests/nav-js.test.mjs && node tests/nav-unified.test.mjs && node tests/ui-components.test.mjs && node tests/ui-tokens.test.mjs && node tests/ui-theme-js.test.mjs`
Expected: 全部通过（components 测试仍要求零硬编码色值）

### Task 4: 部署与验证

**Files:**
- Deploy: 10 个文件到 VPS

- [ ] **Step 1: 本地全量测试**

Run: `node tests/nav-js.test.mjs && node tests/nav-unified.test.mjs && node tests/nav-links.test.mjs && node tests/time-format.test.mjs && node tests/ui-tokens.test.mjs && node tests/ui-theme-js.test.mjs && node tests/ui-components.test.mjs && node tests/ui-preview-page.test.mjs`
Expected: 8 个测试全部通过

- [ ] **Step 2: 部署**

按文件路径分别部署：

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/nav.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/js/modules/app/session.js public/js/modules/app/ui-helpers.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/css/components.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/index.html root@<VPS_IPV4>:/opt/freemail-db-api/public/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no public/html/app.html public/html/admin.html public/html/mailboxes.html public/html/mailbox.html public/html/domain-migrate.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/
```

- [ ] **Step 3: md5 校验与 HTTP 检查**

```bash
for f in js/nav.js js/modules/app/session.js js/modules/app/ui-helpers.js css/components.css index.html html/app.html html/admin.html html/mailboxes.html html/mailbox.html html/domain-migrate.html; do
  l=$(md5sum "public/$f" | cut -d' ' -f1)
  r=$(ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/$f" | cut -d' ' -f1)
  [ "$l" = "$r" ] && echo "MATCH $f" || echo "DIFF  $f"
done
for path in / /html/admin.html /html/mailboxes.html /html/mailbox.html /html/domain-migrate.html; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "http://<VPS_IPV4>:18080$path"
done
```

Expected: 10 个 MATCH，5 个 200

- [ ] **Step 4: 用户验收**

用户硬刷新后逐页检查：

1. 每个页面都能看到统一导航，任意页面可达任意页面
2. 管理员/演示模式能看到"所有邮箱、用户管理"；普通用户/邮箱用户看不到
3. 当前页面入口高亮
4. 不再出现 GitHub、域名迁移入口
5. 退出登录在所有页面可用
