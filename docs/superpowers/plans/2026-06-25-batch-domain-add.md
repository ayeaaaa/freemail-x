# Batch Domain Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the main Freemail page to add multiple domains from one comma-separated input.

**Architecture:** Keep the existing backend `POST /api/domains` single-domain contract unchanged. Add front-end parsing, deduplication, sequential submission, and summary toast behavior in the existing `public/js/app.js` click handler.

**Tech Stack:** Browser JavaScript modules, existing `api()` helper, existing toast UI, Node for lightweight regression checks.

---

### Task 1: Front-End Batch Domain Add

**Files:**
- Modify: `public/js/app.js:193-204`
- Create: `tests/batch-domain-add-parse.test.mjs`

- [ ] **Step 1: Write the failing parser regression test**

Create `tests/batch-domain-add-parse.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

function parseDomains(input) {
  return Array.from(new Set(
    String(input || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

assert.deepEqual(parseDomains('a.com,b.com,c.com'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(parseDomains('a.com, b.com, a.com, , C.COM'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(parseDomains(''), []);

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
assert.ok(source.includes(".split(',')"), 'domain add handler should split comma-separated input');
assert.ok(source.includes('successCount'), 'domain add handler should report batch success count');
assert.ok(source.includes('failedCount'), 'domain add handler should report batch failure count');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/batch-domain-add-parse.test.mjs
```

Expected: FAIL because `public/js/app.js` does not split comma-separated input or track `successCount` / `failedCount` yet.

- [ ] **Step 3: Implement minimal front-end batch handling**

Replace `public/js/app.js` lines `193-204` with:

```js
if (els.domainAddBtn) els.domainAddBtn.onclick = async () => {
  const domainsToAdd = Array.from(new Set(
    String(els.domainAddInput?.value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
  if (!domainsToAdd.length) return showToast('请输入域名', 'warn');

  let successCount = 0;
  let failedCount = 0;
  for (const domain of domainsToAdd) {
    try {
      await api('/api/domains', { method: 'POST', body: JSON.stringify({ domain }) });
      successCount += 1;
    } catch (_) {
      failedCount += 1;
    }
  }

  if (successCount > 0) {
    els.domainAddInput.value = '';
    await loadDomains(domainSelect, api);
  }

  if (failedCount > 0) {
    showToast(`已添加 ${successCount} 个域名，失败 ${failedCount} 个`, successCount > 0 ? 'warn' : 'error');
  } else {
    showToast(`已添加 ${successCount} 个域名`, 'success');
  }
};
```

- [ ] **Step 4: Run local regression test**

Run:

```bash
node tests/batch-domain-add-parse.test.mjs
```

Expected: PASS with no output.

- [ ] **Step 5: Deploy static JS and verify live page references updated file**

Copy `public/js/app.js` to `/opt/freemail-db-api/public/js/app.js` on the VPS over SSH port `<SSH_PORT>` and reload the page.

Run a browser/manual verification:

```text
Input: batchtest1.example,batchtest2.example
Click: 添加
Expected: toast says 已添加 2 个域名
Expected: both domains appear in the domain dropdown after refresh
```

Do not restart `freemail-db-api` for static JS-only changes unless the deployed server caches static files in memory.
