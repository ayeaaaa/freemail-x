# 时间显示东八区修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复前端时间解析，使全部页面时间按东八区（Asia/Shanghai）显示，并恢复按时间排序。

**Architecture:** 在 `public/js/core/utils.js` 新增共享解析函数 `parseServerTime`，所有模块的时间格式化函数与排序比较器改用它，再统一用 `Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' })` 输出。解析失败时保持现有回退（返回原始字符串）。

**Tech Stack:** 原生浏览器 ES Module，无构建步骤；Node 直接导入模块跑测试。

## Global Constraints

- 不改后端、数据库、HTML 结构
- 不改 `mock.js` / `mock-api.js`
- 保留每个格式化函数现有的输出格式（是否含秒、移动端两行等）
- 不新增依赖；`parseServerTime` 是唯一新增导出
- 解析失败时返回原始字符串（不丢信息）
- 不提交 git（用户约定 no-commit 模式）
- 部署目标：`<VPS_IPV4>`，SSH `ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4>`，目录 `/opt/freemail-db-api/public/`

---

### Task 1: core/utils.js 新增 parseServerTime 并修 formatTime/formatRelativeTime

**Files:**
- Modify: `public/js/core/utils.js`
- Create: `tests/time-format.test.mjs`

**Interfaces:**
- Produces: `parseServerTime(ts)` → `Date | null`（具名导出 + 默认导出对象成员），供后续所有任务使用
- Produces: `formatTime(ts, options)`、`formatRelativeTime(ts)` 保持原签名，改为东八区正确输出

- [ ] **Step 1: 写失败测试（新建 tests/time-format.test.mjs）**

```js
import assert from 'node:assert/strict';
import { parseServerTime, formatTime, formatRelativeTime } from '../public/js/core/utils.js';

const UTC = Date.UTC(2026, 9, 4, 14, 52, 35);

// parseServerTime：数据库格式（+00 无冒号）
assert.equal(parseServerTime('2026-10-04 14:52:35.973538+00').getTime(), UTC + 973);
// 无时区 → 按 UTC
assert.equal(parseServerTime('2026-10-04 14:52:35').getTime(), UTC);
// ISO Z
assert.equal(parseServerTime('2026-10-04T14:52:35.973Z').getTime(), UTC + 973);
// 带冒号偏移
assert.equal(parseServerTime('2026-10-04T22:52:35+08:00').getTime(), UTC);
// 无冒号偏移
assert.equal(parseServerTime('2026-10-04T22:52:35+0800').getTime(), UTC);
// 纯日期
assert.equal(parseServerTime('2026-10-04').getTime(), Date.UTC(2026, 9, 4));
// 毫秒数字
assert.equal(parseServerTime(1780000000000).getTime(), 1780000000000);
// 空值/垃圾 → null
assert.equal(parseServerTime(''), null);
assert.equal(parseServerTime(null), null);
assert.equal(parseServerTime('not-a-date'), null);

// formatTime：东八区输出
assert.equal(formatTime('2026-10-04 14:52:35.973538+00'), '2026/10/4 22:52:35');
assert.equal(formatTime('2026-10-04T22:52:35+08:00'), '2026/10/4 22:52:35');
assert.equal(formatTime('2026-10-04 14:52:35'), '2026/10/4 22:52:35');

// formatRelativeTime：未来时间不应输出负数
assert.equal(formatRelativeTime(''), '');
assert.equal(formatRelativeTime(null), '');

console.log('time-format core: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/time-format.test.mjs`
Expected: FAIL（`parseServerTime` 不是导出函数 / 格式断言失败）

- [ ] **Step 3: 修改 core/utils.js**

在 `formatTime` 函数之前插入 `parseServerTime`：

```js
/**
 * 解析服务端时间（兼容数据库 +00 格式、ISO、无时区、数字）
 * @param {string|number|Date} ts - 时间戳
 * @returns {Date|null}
 */
export function parseServerTime(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let s = String(ts).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  s = s.replace(' ', 'T');
  // "+00" / "-05"（小时偏移无冒号）补全为 "+00:00"，仅匹配时间部分之后
  s = s.replace(/(T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)([+-]\d{2})$/, '$1$2:00');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const hasTime = /T\d{2}:\d{2}/.test(s);
  if (hasTime && !hasTimezone) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
```

将 `formatTime` 替换为：

```js
export function formatTime(ts, options = {}) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...options
    }).format(d);
  } catch (_) {
    return String(ts);
  }
}
```

将 `formatRelativeTime` 替换为：

```js
export function formatRelativeTime(ts) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return formatTime(ts, { year: 'numeric', month: 'numeric', day: 'numeric' });
}
```

在文件末尾默认导出对象中加入 `parseServerTime,`（放在 `formatTime,` 之前）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/time-format.test.mjs`
Expected: `time-format core: all assertions passed`

### Task 2: 6 个模块格式化/排序函数改用共享解析

**Files:**
- Modify: `public/js/modules/app/ui-helpers.js`
- Modify: `public/js/modules/mailbox/email-list.js`
- Modify: `public/js/modules/mailboxes/render.js`
- Modify: `public/js/modules/mailboxes/grid-view.js`
- Modify: `public/js/modules/mailboxes/filters.js`
- Modify: `public/js/modules/admin/user-list.js`
- Modify: `tests/time-format.test.mjs`（追加断言）

**Interfaces:**
- Consumes: `parseServerTime`（Task 1，路径 `../../core/utils.js`）
- Produces: 各模块原有导出函数签名不变（`formatTs`、`formatTsMobile`、`formatTime`、`sortEmails`、`sortMailboxes`），行为改为东八区正确输出

- [ ] **Step 1: 追加失败测试**

在 `tests/time-format.test.mjs` 末尾（`console.log` 之前）插入：

```js
import { formatTs, formatTsMobile } from '../public/js/modules/app/ui-helpers.js';
import { formatTime as formatMailboxTime, sortEmails } from '../public/js/modules/mailbox/email-list.js';
import { formatTime as formatRenderTime } from '../public/js/modules/mailboxes/render.js';
import { formatTime as formatGridTime } from '../public/js/modules/mailboxes/grid-view.js';
import { sortMailboxes } from '../public/js/modules/mailboxes/filters.js';
import { formatTime as formatUserTime } from '../public/js/modules/admin/user-list.js';

const DB_TIME = '2026-10-04 14:52:35.973538+00';
const EAST8 = '2026/10/4 22:52:35';

assert.equal(formatTs(DB_TIME), EAST8);
assert.equal(formatMailboxTime(DB_TIME), EAST8);
assert.equal(formatRenderTime(DB_TIME), EAST8);
assert.equal(formatGridTime(DB_TIME), EAST8);
assert.equal(formatUserTime(DB_TIME), EAST8);
assert.ok(formatTsMobile(DB_TIME).includes('22:52:35'));

const emails = [
  { subject: 'a', received_at: '2026-10-04 14:52:35+00' },
  { subject: 'b', received_at: '2026-10-04T23:00:00+08:00' },
  { subject: 'c', received_at: '2026-10-04 13:00:00+00' }
];
assert.deepEqual(sortEmails(emails, 'received_at', 'desc').map(e => e.subject), ['b', 'a', 'c']);
assert.deepEqual(sortEmails(emails, 'received_at', 'asc').map(e => e.subject), ['c', 'a', 'b']);

const boxes = [
  { address: 'a@x.com', created_at: '2026-10-04 14:52:35+00', is_pinned: 0 },
  { address: 'b@x.com', created_at: '2026-10-04T23:00:00+08:00', is_pinned: 0 },
  { address: 'c@x.com', created_at: '2026-10-04 13:00:00+00', is_pinned: 1 }
];
assert.deepEqual(sortMailboxes(boxes, 'created_at', 'desc').map(m => m.address), ['c@x.com', 'b@x.com', 'a@x.com']);
```

注意：ESM 的 `import` 必须位于文件顶部。追加时把这些 import 移到文件头部（与已有 import 合并区），断言留在末尾。

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/time-format.test.mjs`
Expected: FAIL（东八区断言不匹配，当前返回原始字符串或错误时间）

- [ ] **Step 3: 修改 6 个模块文件**

每个文件在 import 区加入（路径按文件层级调整，均为 `../../core/utils.js`）：

```js
import { parseServerTime } from '../../core/utils.js';
```

`public/js/modules/app/ui-helpers.js` — 替换 `formatTs` 与 `formatTsMobile`：

```js
export function formatTs(ts) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch (_) { return String(ts); }
}

export function formatTsMobile(ts) {
  const d = parseServerTime(ts);
  if (!d) return '<span></span><span></span>';
  try {
    const dateStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).format(d);
    const timeStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
    return `<span>${dateStr}</span><span>${timeStr}</span>`;
  } catch (_) { return `<span></span>${ts}`; }
}
```

`public/js/modules/mailbox/email-list.js` — 替换 `formatTime`：

```js
export function formatTime(ts) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(d);
  } catch (_) {
    return String(ts);
  }
}
```

同文件 `sortEmails` 的比较分支替换为：

```js
      case 'received_at':
      default:
        valueA = parseServerTime(a.received_at)?.getTime() ?? 0;
        valueB = parseServerTime(b.received_at)?.getTime() ?? 0;
        break;
```

`public/js/modules/mailboxes/render.js` — 替换 `formatTime`：

```js
export function formatTime(ts) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch (_) { return String(ts); }
}
```

`public/js/modules/mailboxes/grid-view.js` — 替换 `formatTime`（同上代码）。

`public/js/modules/mailboxes/filters.js` — `sortMailboxes` 比较分支替换为：

```js
      case 'created_at':
      default:
        valueA = parseServerTime(a.created_at)?.getTime() ?? 0;
        valueB = parseServerTime(b.created_at)?.getTime() ?? 0;
        break;
```

`public/js/modules/admin/user-list.js` — 替换 `formatTime`（同 render.js 代码）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/time-format.test.mjs`
Expected: `time-format core: all assertions passed`

### Task 3: 邮件详情与发件箱显示修复

**Files:**
- Modify: `public/js/modules/app/email-viewer.js`
- Modify: `public/js/modules/app/compose.js`
- Modify: `tests/time-format.test.mjs`（追加源码级断言）

**Interfaces:**
- Consumes: `parseServerTime`（Task 1）、`formatTs`（Task 2）
- Produces: 邮件详情时间东八区显示（保持无秒）；发件箱发送时间东八区显示

- [ ] **Step 1: 追加失败测试**

在 `tests/time-format.test.mjs` 顶部 import 区加入：

```js
import fs from 'node:fs';
```

在文件末尾 `console.log` 之前插入：

```js
const emailViewerSrc = fs.readFileSync(new URL('../public/js/modules/app/email-viewer.js', import.meta.url), 'utf8');
assert.ok(emailViewerSrc.includes("from '../../core/utils.js'"), 'email-viewer.js must import parseServerTime');
assert.ok(emailViewerSrc.includes('parseServerTime(email.received_at)'), 'email-viewer.js must use parseServerTime');

const composeSrc = fs.readFileSync(new URL('../public/js/modules/app/compose.js', import.meta.url), 'utf8');
assert.ok(composeSrc.includes('formatTs'), 'compose.js must use formatTs for sent time');
assert.ok(!composeSrc.includes('escapeHtml(e.created_at || ' + "''" + ')'), 'compose.js must not render raw created_at');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/time-format.test.mjs`
Expected: FAIL（源码断言不满足）

- [ ] **Step 3: 修改两个文件**

`public/js/modules/app/email-viewer.js`：

在 import 区加入：

```js
import { parseServerTime } from '../../core/utils.js';
```

将 `if (email.received_at) { ... }` 块（约 35-43 行）替换为：

```js
    if (email.received_at) {
      const d = parseServerTime(email.received_at);
      const timeStr = d
        ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
        : String(email.received_at);
      metaHtml += `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-clock"/></svg> ${timeStr}</span>`;
    }
```

`public/js/modules/app/compose.js`：

将 import 行：

```js
import { escapeHtml } from './ui-helpers.js';
```

改为：

```js
import { escapeHtml, formatTs } from './ui-helpers.js';
```

将第 140 行：

```js
        <div class="meta-row"><span class="meta-label">发送时间：</span><span class="meta-value">${escapeHtml(e.created_at || '')}</span></div>
```

改为：

```js
        <div class="meta-row"><span class="meta-label">发送时间：</span><span class="meta-value">${escapeHtml(formatTs(e.created_at))}</span></div>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/time-format.test.mjs`
Expected: `time-format core: all assertions passed`

### Task 4: 部署与线上验证

**Files:**
- Deploy: 8 个修改的 JS 文件到 VPS

- [ ] **Step 1: 本地全量测试**

Run: `node tests/time-format.test.mjs && node tests/ui-tokens.test.mjs && node tests/ui-theme-js.test.mjs && node tests/ui-components.test.mjs && node tests/ui-preview-page.test.mjs`
Expected: 5 个测试全部通过

- [ ] **Step 2: 部署**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no \
  public/js/core/utils.js \
  root@<VPS_IPV4>:/opt/freemail-db-api/public/js/core/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no \
  public/js/modules/app/ui-helpers.js \
  public/js/modules/app/email-viewer.js \
  public/js/modules/app/compose.js \
  root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/app/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no \
  public/js/modules/mailbox/email-list.js \
  root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/mailbox/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no \
  public/js/modules/mailboxes/render.js \
  public/js/modules/mailboxes/grid-view.js \
  public/js/modules/mailboxes/filters.js \
  root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/mailboxes/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> -o StrictHostKeyChecking=no \
  public/js/modules/admin/user-list.js \
  root@<VPS_IPV4>:/opt/freemail-db-api/public/js/modules/admin/
```

- [ ] **Step 3: md5 校验与 HTTP 检查**

```bash
for f in js/core/utils.js js/modules/app/ui-helpers.js js/modules/app/email-viewer.js js/modules/app/compose.js js/modules/mailbox/email-list.js js/modules/mailboxes/render.js js/modules/mailboxes/grid-view.js js/modules/mailboxes/filters.js js/modules/admin/user-list.js; do
  l=$(md5sum "public/$f" | cut -d' ' -f1)
  r=$(ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4> "md5sum /opt/freemail-db-api/public/$f" | cut -d' ' -f1)
  [ "$l" = "$r" ] && echo "MATCH $f" || echo "DIFF  $f"
done
curl -sS -o /dev/null -w "index %{http_code}\n" http://<VPS_IPV4>:18080/
curl -sS -o /dev/null -w "mailbox %{http_code}\n" http://<VPS_IPV4>:18080/html/mailbox.html
curl -sS -o /dev/null -w "admin %{http_code}\n" http://<VPS_IPV4>:18080/html/admin.html
```

Expected: 9 个 MATCH，3 个 200

- [ ] **Step 4: 用户目视验收**

用户浏览器硬刷新（Ctrl+F5）后检查：主页历史邮箱时间、邮件列表时间、邮件详情时间、我的邮箱时间、管理页用户时间、发件箱时间均为东八区（UTC 时间 +8 小时），排序正常。
