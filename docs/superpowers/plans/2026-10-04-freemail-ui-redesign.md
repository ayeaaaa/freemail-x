# Freemail UI 现代化重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Freemail 全部页面提供三套视觉风格（Calm/Warm/Tech）× 浅色/深色共 6 种可切换主题，并现代化全部页面样式。

**Architecture:** 新建 `tokens.css` 定义 6 组 CSS 变量（`[data-style][data-mode]` 选择器），`components.css` 统一组件层，`theme.js` 管理切换与持久化，`theme-preview.html` 作为阶段 1 验收页。阶段 2 将各页面 CSS 迁移为令牌引用并退役全部 `_black.css`。

**Tech Stack:** 纯 CSS 变量 + 原生 JS（无构建步骤），静态部署到 VPS 服务器 `/opt/freemail-db-api/public/`。

## Global Constraints

- 保留全部 HTML 元素 ID、class 名、data 属性（JS 选择器依赖）
- 不改任何 JS 业务逻辑、API、后端
- 不使用外部字体（移除 Google Fonts 引用，用系统字体栈）
- 部署为静态文件，不重启服务
- 服务器旧文件部署时改名为 `.bak`，可回滚
- 主题属性：`<html data-style="calm|warm|tech" data-mode="light|dark">`
- localStorage 键：`mf:ui-theme`，值 `{"style":"calm","mode":"light"}`
- 色板以设计文档为准：`docs/superpowers/specs/2026-10-04-freemail-ui-redesign-design.md`

---

## 阶段 1：令牌 + 组件层 + 切换器 + 预览页

### Task 1: 设计令牌 tokens.css

**Files:**
- Create: `public/css/tokens.css`
- Test: `tests/ui-tokens.test.mjs`

**Interfaces:**
- Produces: CSS 变量 `--bg --surface --surface-2 --text --text-2 --text-3 --border --border-strong --accent --accent-hover --accent-soft --accent-contrast --danger --danger-soft --success --success-soft --warning --warning-soft --radius-sm --radius-md --radius-lg --shadow --shadow-lg --font-sans --font-mono`，供 components.css 与全部页面 CSS 使用

- [ ] **Step 1: 写失败测试**

Create `tests/ui-tokens.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tokens = fs.readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');

const combos = [
  ':root,\n[data-style="calm"][data-mode="light"]',
  '[data-style="calm"][data-mode="dark"]',
  '[data-style="warm"][data-mode="light"]',
  '[data-style="warm"][data-mode="dark"]',
  '[data-style="tech"][data-mode="dark"]',
  '[data-style="tech"][data-mode="light"]'
];
for (const selector of combos) {
  assert.ok(tokens.includes(selector), `tokens.css must define ${selector}`);
}

const requiredTokens = [
  '--bg', '--surface', '--surface-2', '--text', '--text-2', '--text-3',
  '--border', '--border-strong', '--accent', '--accent-hover', '--accent-soft',
  '--accent-contrast', '--danger', '--danger-soft', '--success', '--success-soft',
  '--warning', '--warning-soft', '--radius-sm', '--radius-md', '--radius-lg',
  '--shadow', '--shadow-lg', '--font-sans', '--font-mono', '--overlay'
];
for (const token of requiredTokens) {
  const count = (tokens.match(new RegExp(`\\${token}:`, 'g')) || []).length;
  assert.equal(count, 6, `${token} must be defined in all 6 combos (found ${count})`);
}

assert.ok(tokens.includes('color-scheme: dark'), 'dark combos must set color-scheme');
assert.ok(tokens.includes('color-scheme: light'), 'light combos must set color-scheme');

console.log('ui-tokens: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/ui-tokens.test.mjs`
Expected: FAIL with `ENOENT` (tokens.css 不存在)

- [ ] **Step 3: 创建 tokens.css**

Create `public/css/tokens.css`:

```css
/* ============================================================
   Freemail 设计令牌
   3 风格 × 2 模式：calm/warm/tech × light/dark
   切换：<html data-style="..." data-mode="...">
   ============================================================ */

:root,
[data-style="calm"][data-mode="light"] {
  color-scheme: light;
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-2: #f4f4f5;
  --text: #18181b;
  --text-2: #52525b;
  --text-3: #71717a;
  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;
  --accent-contrast: #ffffff;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="calm"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #09090b;
  --surface: #18181b;
  --surface-2: #1f1f23;
  --text: #fafafa;
  --text-2: #d4d4d8;
  --text-3: #a1a1aa;
  --border: #27272a;
  --border-strong: #3f3f46;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-soft: #1e1b4b;
  --accent-contrast: #ffffff;
  --danger: #ef4444;
  --danger-soft: #2c1315;
  --success: #22c55e;
  --success-soft: #0f2417;
  --warning: #f59e0b;
  --warning-soft: #2b1f0a;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="warm"][data-mode="light"] {
  color-scheme: light;
  --bg: #faf9f7;
  --surface: #ffffff;
  --surface-2: #f5f4f2;
  --text: #292524;
  --text-2: #57534e;
  --text-3: #78716c;
  --border: #e7e5e4;
  --border-strong: #d6d3d1;
  --accent: #ea580c;
  --accent-hover: #c2410c;
  --accent-soft: #fff7ed;
  --accent-contrast: #ffffff;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.1);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="warm"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #1c1917;
  --surface: #292524;
  --surface-2: #33302c;
  --text: #fafaf9;
  --text-2: #d6d3d1;
  --text-3: #a8a29e;
  --border: #44403c;
  --border-strong: #57534e;
  --accent: #fb923c;
  --accent-hover: #fdba74;
  --accent-soft: #431407;
  --accent-contrast: #1c1917;
  --danger: #ef4444;
  --danger-soft: #2c1315;
  --success: #22c55e;
  --success-soft: #0f2417;
  --warning: #f59e0b;
  --warning-soft: #2b1f0a;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.6);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="tech"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #0a0e14;
  --surface: #11161f;
  --surface-2: #161c27;
  --text: #e6edf3;
  --text-2: #b3bcc7;
  --text-3: #8b949e;
  --border: #21262d;
  --border-strong: #30363d;
  --accent: #22d3ee;
  --accent-hover: #67e8f9;
  --accent-soft: #083344;
  --accent-contrast: #0a0e14;
  --danger: #f87171;
  --danger-soft: #2c1315;
  --success: #34d399;
  --success-soft: #0f2417;
  --warning: #fbbf24;
  --warning-soft: #2b1f0a;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="tech"][data-mode="light"] {
  color-scheme: light;
  --bg: #f6f8fa;
  --surface: #ffffff;
  --surface-2: #eef1f4;
  --text: #1f2328;
  --text-2: #424a53;
  --text-3: #656d76;
  --border: #d0d7de;
  --border-strong: #afb8c1;
  --accent: #0891b2;
  --accent-hover: #0e7490;
  --accent-soft: #ecfeff;
  --accent-contrast: #ffffff;
  --danger: #cf222e;
  --danger-soft: #fef2f2;
  --success: #1a7f37;
  --success-soft: #f0fdf4;
  --warning: #9a6700;
  --warning-soft: #fffbeb;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

/* 基础应用 */
html {
  background: var(--bg);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  transition: background-color 0.15s ease, color 0.15s ease;
}

* {
  scrollbar-color: var(--border-strong) transparent;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/ui-tokens.test.mjs`
Expected: `ui-tokens: all assertions passed`

### Task 2: 主题切换器 theme.js + theme-switcher.css

**Files:**
- Create: `public/js/theme.js`
- Create: `public/css/theme-switcher.css`
- Test: `tests/ui-theme-js.test.mjs`

**Interfaces:**
- Produces: `window.FreemailTheme = { get(): {style, mode}, set(style, mode): void, init(): void }`
- Consumes: `tokens.css` 的 `[data-style][data-mode]` 选择器

- [ ] **Step 1: 写失败测试（功能测试 + 源码检查）**

Create `tests/ui-theme-js.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/js/theme.js', import.meta.url), 'utf8');

const storage = new Map();
const attributes = {};
const documentElement = {
  setAttribute: (key, value) => { attributes[key] = value; },
  getAttribute: (key) => attributes[key] || null
};
const mockWindow = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {}
};
const mockDocument = {
  documentElement,
  readyState: 'complete',
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {}
  }),
  body: { appendChild: () => {} }
};
const mockLocalStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, value)
};

const factory = new Function('window', 'document', 'localStorage', source);
factory(mockWindow, mockDocument, mockLocalStorage);

const api = mockWindow.FreemailTheme;
assert.ok(api, 'theme.js must expose window.FreemailTheme');
assert.deepEqual(api.get(), { style: 'calm', mode: 'light' }, 'defaults must be calm + light');

api.set('warm', 'dark');
assert.equal(attributes['data-style'], 'warm');
assert.equal(attributes['data-mode'], 'dark');
assert.equal(api.get().style, 'warm');
assert.equal(api.get().mode, 'dark');
assert.ok(storage.get('mf:ui-theme').includes('warm'), 'preference must be persisted');

api.set('bogus', 'neon');
assert.equal(api.get().style, 'warm', 'invalid style must be ignored');
assert.equal(api.get().mode, 'dark', 'invalid mode must be ignored');

assert.ok(source.includes('mf:ui-theme'), 'storage key must be mf:ui-theme');
assert.ok(source.includes("'tech'"), 'tech style must be supported');
assert.ok(!source.includes('_black.css'), 'theme.js must not reference legacy _black.css');

console.log('ui-theme-js: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/ui-theme-js.test.mjs`
Expected: FAIL with `ENOENT`

- [ ] **Step 3: 创建 theme.js**

Create `public/js/theme.js`:

```js
/* =============================================
   Freemail 主题切换
   风格：calm / warm / tech    模式：light / dark
   API: window.FreemailTheme = { get, set, init }
   ============================================= */

(function () {
  var STORAGE_KEY = 'mf:ui-theme';
  var STYLES = ['calm', 'warm', 'tech'];
  var MODES = ['light', 'dark'];
  var STYLE_LABELS = { calm: 'Calm', warm: 'Warm', tech: 'Tech' };
  var SWATCHES = {
    calm: ['#fafafa', '#4f46e5', '#18181b'],
    warm: ['#faf9f7', '#ea580c', '#292524'],
    tech: ['#0a0e14', '#22d3ee', '#e6edf3']
  };

  function readSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function systemMode() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function resolve() {
    var saved = readSaved() || {};
    var style = STYLES.indexOf(saved.style) !== -1 ? saved.style : 'calm';
    var mode = MODES.indexOf(saved.mode) !== -1 ? saved.mode : systemMode();
    return { style: style, mode: mode };
  }

  function apply(style, mode) {
    document.documentElement.setAttribute('data-style', style);
    document.documentElement.setAttribute('data-mode', mode);
  }

  function save(style, mode) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ style: style, mode: mode }));
    } catch (_) {}
  }

  function get() {
    return resolve();
  }

  function set(style, mode) {
    var current = resolve();
    var nextStyle = STYLES.indexOf(style) !== -1 ? style : current.style;
    var nextMode = MODES.indexOf(mode) !== -1 ? mode : current.mode;
    apply(nextStyle, nextMode);
    save(nextStyle, nextMode);
    renderPanel();
  }

  var panel = null;
  var button = null;

  function closePanel() {
    if (panel) panel.style.display = 'none';
  }

  function renderPanel() {
    if (!panel) return;
    var current = resolve();
    var styleCards = STYLES.map(function (style) {
      var active = style === current.style ? ' is-active' : '';
      var swatch = SWATCHES[style].map(function (color) {
        return '<span class="theme-swatch" style="background:' + color + '"></span>';
      }).join('');
      return '<button type="button" class="theme-style-card' + active + '" data-theme-style="' + style + '">' +
        '<span class="theme-swatches">' + swatch + '</span>' +
        '<span class="theme-style-name">' + STYLE_LABELS[style] + '</span>' +
        '</button>';
    }).join('');
    var modeButtons = MODES.map(function (mode) {
      var active = mode === current.mode ? ' is-active' : '';
      var label = mode === 'light' ? '浅色' : '深色';
      return '<button type="button" class="theme-mode-btn' + active + '" data-theme-mode="' + mode + '">' + label + '</button>';
    }).join('');
    panel.innerHTML =
      '<div class="theme-panel-title">风格</div>' +
      '<div class="theme-style-grid">' + styleCards + '</div>' +
      '<div class="theme-panel-title">明暗</div>' +
      '<div class="theme-mode-row">' + modeButtons + '</div>';
    panel.querySelectorAll('[data-theme-style]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.stopPropagation();
        set(el.getAttribute('data-theme-style'), resolve().mode);
      });
    });
    panel.querySelectorAll('[data-theme-mode]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.stopPropagation();
        set(resolve().style, el.getAttribute('data-theme-mode'));
      });
    });
  }

  function buildUI() {
    if (button || !document.body) return;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'theme-switcher-btn';
    button.className = 'theme-switcher-btn';
    button.setAttribute('aria-label', '切换主题');
    button.title = '切换主题';
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="14.5" r="2.5"/><circle cx="8.5" cy="9.5" r="2.5"/>' +
      '<path d="M12 2a10 10 0 1 0 10 10c0-1.1-.9-2-2-2h-2a3 3 0 0 1-3-3V4a2 2 0 0 0-2-2z"/></svg>';

    panel = document.createElement('div');
    panel.id = 'theme-switcher-panel';
    panel.className = 'theme-switcher-panel';
    panel.style.display = 'none';

    var anchor = document.querySelector('.nav-actions');
    if (anchor) {
      var wrap = document.createElement('div');
      wrap.className = 'theme-switcher-anchor';
      wrap.appendChild(button);
      wrap.appendChild(panel);
      anchor.appendChild(wrap);
    } else {
      button.classList.add('theme-switcher-fixed');
      document.body.appendChild(button);
      panel.classList.add('theme-switcher-panel-fixed');
      document.body.appendChild(panel);
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function (event) {
      if (panel && panel.style.display !== 'none' && !panel.contains(event.target)) {
        closePanel();
      }
    });

    renderPanel();
  }

  function init() {
    apply(resolve().style, resolve().mode);
    buildUI();
  }

  window.FreemailTheme = { get: get, set: set, init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 4: 创建 theme-switcher.css**

Create `public/css/theme-switcher.css`:

```css
/* 主题切换器 */
.theme-switcher-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.theme-switcher-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.theme-switcher-fixed {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 999;
  box-shadow: var(--shadow-lg);
}

.theme-switcher-anchor {
  position: relative;
  display: inline-flex;
}

.theme-switcher-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  width: 240px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.theme-switcher-panel-fixed {
  position: fixed;
  right: 20px;
  bottom: 68px;
  top: auto;
}

.theme-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  margin: 2px 0 8px;
}

.theme-panel-title + .theme-panel-title,
.theme-mode-row {
  margin-top: 12px;
}

.theme-style-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.theme-style-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.theme-style-card:hover {
  border-color: var(--border-strong);
}

.theme-style-card.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.theme-swatches {
  display: inline-flex;
  gap: 3px;
}

.theme-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
}

.theme-style-name {
  font-size: 12px;
  font-weight: 500;
}

.theme-mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-mode-btn {
  padding: 7px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.theme-mode-btn:hover {
  border-color: var(--border-strong);
}

.theme-mode-btn.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node tests/ui-theme-js.test.mjs`
Expected: `ui-theme-js: all assertions passed`

### Task 3: 组件层 components.css

**Files:**
- Create: `public/css/components.css`
- Test: `tests/ui-components.test.mjs`

**Interfaces:**
- Consumes: Task 1 的全部令牌
- Produces: 类名 `.btn .btn-primary .btn-secondary .btn-ghost .btn-danger .btn-sm .input .select .card .badge .badge-success .badge-danger .modal-overlay .modal-card .toast .sidebar-item .topbar .segmented`，供页面迁移使用

- [ ] **Step 1: 写失败测试**

Create `tests/ui-components.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/components.css', import.meta.url), 'utf8');

const requiredSelectors = [
  '.btn', '.btn-primary', '.btn-secondary', '.btn-ghost', '.btn-danger', '.btn-sm',
  '.input', '.select', '.card', '.badge', '.badge-success', '.badge-danger',
  '.modal-overlay', '.modal-card', '.toast', '.topbar'
];
for (const selector of requiredSelectors) {
  assert.ok(css.includes(selector), `components.css must define ${selector}`);
}

const tokenUsage = (css.match(/var\(--[a-z0-9-]+\)/g) || []).length;
assert.ok(tokenUsage >= 60, `components.css must use design tokens (found ${tokenUsage})`);

const hardcodedColors = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
assert.equal(hardcodedColors.length, 0, `components.css must not hardcode colors: ${hardcodedColors.join(', ')}`);

console.log('ui-components: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/ui-components.test.mjs`
Expected: FAIL with `ENOENT`

- [ ] **Step 3: 创建 components.css**

Create `public/css/components.css`（完整内容，全部使用令牌，零硬编码色值）：

```css
/* ============================================================
   Freemail 统一组件层
   全部颜色/圆角/阴影来自 tokens.css
   ============================================================ */

/* ---------- 按钮 ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-sans);
  line-height: 1;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.btn-secondary {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.btn-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--accent-contrast);
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 13px;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
}

/* ---------- 输入 ---------- */
.input,
.select,
textarea.input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-family: var(--font-sans);
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

textarea.input {
  height: auto;
  padding: 10px 12px;
  resize: vertical;
}

.input::placeholder {
  color: var(--text-3);
}

.input:focus,
.select:focus,
textarea.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.select {
  appearance: none;
  padding-right: 32px;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--text-3) 50%),
    linear-gradient(135deg, var(--text-3) 50%, transparent 50%);
  background-position:
    calc(100% - 15px) calc(50% - 2px),
    calc(100% - 10px) calc(50% - 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

/* ---------- 卡片 ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 20px;
}

/* ---------- 徽章 ---------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: var(--surface-2);
  color: var(--text-2);
}

.badge-success {
  background: var(--success-soft);
  color: var(--success);
}

.badge-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.badge-accent {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ---------- 弹窗 ---------- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.modal-card {
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
}

/* ---------- Toast ---------- */
.toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast-item {
  min-width: 240px;
  max-width: 360px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-size: 14px;
}

.toast-item.is-success {
  border-left-color: var(--success);
}

.toast-item.is-error {
  border-left-color: var(--danger);
}

/* ---------- 顶栏 ---------- */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

/* ---------- 分段控件 ---------- */
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.segmented button {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: calc(var(--radius-md) - 3px);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}

.segmented button.is-active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/ui-components.test.mjs`
Expected: `ui-components: all assertions passed`

### Task 4: 预览页 theme-preview.html

**Files:**
- Create: `public/theme-preview.html`
- Test: `tests/ui-preview-page.test.mjs`

**Interfaces:**
- Consumes: tokens.css / components.css / theme-switcher.css / theme.js

- [ ] **Step 1: 写失败测试**

Create `tests/ui-preview-page.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/theme-preview.html', import.meta.url), 'utf8');

for (const asset of ['/css/tokens.css', '/css/components.css', '/css/theme-switcher.css', '/js/theme.js']) {
  assert.ok(html.includes(asset), `preview page must load ${asset}`);
}

for (const demo of ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'input', 'card', 'badge-success', 'modal-card', 'toast-item']) {
  assert.ok(html.includes(demo), `preview page must demo ${demo}`);
}

assert.ok(html.includes('data-style'), 'preview must include no-FOUC theme bootstrap');
assert.ok(html.includes('mf:ui-theme'), 'preview bootstrap must read mf:ui-theme');
assert.ok(!html.includes('_black.css'), 'preview must not use legacy _black.css');
assert.ok(!html.includes('fonts.googleapis.com'), 'preview must not load external fonts');

console.log('ui-preview-page: all assertions passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/ui-preview-page.test.mjs`
Expected: FAIL with `ENOENT`

- [ ] **Step 3: 创建 theme-preview.html**

Create `public/theme-preview.html`（完整文档：head 内联主题引导脚本 + 4 个资源引用 + 各组件演示 + 切换器）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>主题预览 - Freemail</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <script>
    (function () {
      try {
        var saved = JSON.parse(localStorage.getItem('mf:ui-theme') || 'null');
        var styles = ['calm', 'warm', 'tech'];
        var style = saved && styles.indexOf(saved.style) !== -1 ? saved.style : 'calm';
        var mode = saved && (saved.mode === 'light' || saved.mode === 'dark')
          ? saved.mode
          : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-style', style);
        document.documentElement.setAttribute('data-mode', mode);
      } catch (_) {}
    })();
  </script>
  <link rel="stylesheet" href="/css/tokens.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <link rel="stylesheet" href="/css/theme-switcher.css" />
  <style>
    .preview-wrap { max-width: 880px; margin: 0 auto; padding: 24px 20px 80px; }
    .preview-section { margin-top: 32px; }
    .preview-section h2 { font-size: 15px; font-weight: 600; color: var(--text-3); margin: 0 0 12px; }
    .preview-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .preview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .preview-code { font-family: var(--font-mono); font-size: 20px; letter-spacing: 2px; }
  </style>
</head>
<body>
  <header class="topbar">
    <strong style="font-size:15px">Freemail 主题预览</strong>
    <div class="nav-actions">
      <button class="btn btn-ghost btn-sm">Ghost</button>
      <button class="btn btn-secondary btn-sm">Secondary</button>
    </div>
  </header>

  <main class="preview-wrap">
    <section class="preview-section">
      <h2>按钮</h2>
      <div class="preview-row">
        <button class="btn btn-primary">主要按钮</button>
        <button class="btn btn-secondary">次要按钮</button>
        <button class="btn btn-ghost">幽灵按钮</button>
        <button class="btn btn-danger">危险按钮</button>
        <button class="btn btn-primary btn-sm">小号</button>
        <button class="btn btn-secondary" disabled>禁用</button>
      </div>
    </section>

    <section class="preview-section">
      <h2>输入</h2>
      <div class="preview-grid">
        <input class="input" placeholder="输入邮箱地址" />
        <select class="select">
          <option>选择域名</option>
          <option>example.com</option>
        </select>
        <textarea class="input" rows="2" placeholder="邮件内容"></textarea>
      </div>
    </section>

    <section class="preview-section">
      <h2>卡片与徽章</h2>
      <div class="preview-grid">
        <div class="card">
          <div class="preview-row" style="justify-content:space-between">
            <strong style="font-size:14px">user@example.com</strong>
            <span class="badge badge-success">已验证</span>
          </div>
          <p style="color:var(--text-3);font-size:13px;margin:10px 0 0">验证码：<span class="preview-code">778899</span></p>
        </div>
        <div class="card">
          <div class="preview-row" style="justify-content:space-between">
            <strong style="font-size:14px">过期邮箱</strong>
            <span class="badge badge-danger">已过期</span>
          </div>
          <p style="color:var(--text-3);font-size:13px;margin:10px 0 0">3 天后自动清理</p>
        </div>
      </div>
    </section>

    <section class="preview-section">
      <h2>弹窗</h2>
      <div class="card" style="position:relative;padding:0;overflow:hidden;height:200px">
        <div class="modal-overlay" style="position:absolute">
          <div class="modal-card" style="max-width:380px">
            <strong style="font-size:15px">确认删除该邮箱？</strong>
            <p style="color:var(--text-3);font-size:13px;margin:10px 0 16px">删除后邮件将无法恢复。</p>
            <div class="preview-row" style="justify-content:flex-end">
              <button class="btn btn-ghost btn-sm">取消</button>
              <button class="btn btn-danger btn-sm">删除</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="preview-section">
      <h2>Toast</h2>
      <div class="preview-row" style="align-items:flex-start">
        <div class="toast-item is-success" style="position:static">邮箱已复制</div>
        <div class="toast-item is-error" style="position:static">生成失败，请重试</div>
        <div class="toast-item" style="position:static">普通通知</div>
      </div>
    </section>

    <section class="preview-section">
      <h2>分段控件</h2>
      <div class="segmented">
        <button class="is-active">全部</button>
        <button>未读</button>
        <button>收藏</button>
      </div>
    </section>
  </main>

  <script src="/js/theme.js"></script>
</body>
</html>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/ui-preview-page.test.mjs`
Expected: `ui-preview-page: all assertions passed`

### Task 5: 部署阶段 1 并验证

**Files:**
- Deploy: 5 个新文件到 VPS `/opt/freemail-db-api/public/`

- [ ] **Step 1: 本地全量测试**

Run: `node tests/ui-tokens.test.mjs && node tests/ui-theme-js.test.mjs && node tests/ui-components.test.mjs && node tests/ui-preview-page.test.mjs`
Expected: 4 个测试全部通过

- [ ] **Step 2: 部署到 VPS**

```bash
ssh -i ~/.ssh/<SSH_KEY> -p <SSH_PORT> root@<VPS_IPV4> 'mkdir -p /opt/freemail-db-api/public/css /opt/freemail-db-api/public/js'
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/tokens.css public/css/components.css public/css/theme-switcher.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/js/theme.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/theme-preview.html root@<VPS_IPV4>:/opt/freemail-db-api/public/
```

- [ ] **Step 3: 验证 HTTP 可达**

```bash
for path in /theme-preview.html /css/tokens.css /css/components.css /css/theme-switcher.css /js/theme.js; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "http://<VPS_IPV4>:18080$path"
done
```

Expected: 全部 200

- [ ] **Step 4: 用户验收（检查点）**

告知用户打开 `http://<VPS_IPV4>:18080/theme-preview.html`，点击顶栏调色板按钮，检查 6 种组合与组件观感。**等待用户确认后才能进入阶段 2。**

---

## 阶段 2：页面迁移（预览确认后执行）

**迁移映射规则（所有页面任务共用）：**

| 旧值/写法 | 新令牌 |
|---|---|
| `#fff` `#ffffff` `white` 及各类白色表面/玻璃 | `var(--surface)` |
| `#f8fafc` `#f1f5f9` `#f4f4f5` 等浅灰底 | `var(--bg)` / `var(--surface-2)` |
| `--text: #0f172a` 深色文字 | `var(--text)` |
| `#334155` `#475569` | `var(--text-2)` |
| `#64748b` `#94a3b8` | `var(--text-3)` |
| `#e2e8f0` `#e5e7eb` 边框 | `var(--border)` / `var(--border-strong)` |
| `--primary` `#6366f1` `#4f46e5` 及紫蓝渐变 | `var(--accent)` / `var(--accent-hover)` |
| 粉/紫渐变、`linear-gradient` 装饰、玻璃拟态 | 删除，改扁平 `var(--surface)` |
| `#ef4444` `#dc2626` | `var(--danger)` |
| `#10b981` `#16a34a` | `var(--success)` |
| `#f59e0b` `#d97706` | `var(--warning)` |
| 圆角字面量 `border-radius: 8px` 等 | `var(--radius-sm/md/lg)` |
| 阴影字面量 | `var(--shadow)` / `var(--shadow-lg)` |
| 字体 `Poppins` / `Open Sans` | 删除字体引用，`var(--font-sans)` |

**验收标准（每页相同）：**

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/<页面>.css
```

必须无输出（颜色零字面量；仅允许 `var(--...)`）。

### Task 6: 登录页迁移

**Files:**
- Modify: `public/html/login.html`
- Modify: `public/css/login.css`
- Delete links to: `login_black.css`

- [ ] **Step 1: 修改 login.html head**

- `<head>` 开头插入与 Task 4 相同的主题引导内联脚本
- 删除 `login_black.css` link
- 增加 `<link rel="stylesheet" href="/css/tokens.css" />` 与 `/css/components.css`、`/css/theme-switcher.css`
- `<body>` 末尾增加 `<script src="/js/theme.js"></script>`

- [ ] **Step 2: 迁移 login.css 到令牌**

按映射规则替换全部颜色/圆角/阴影/字体；删除渐变装饰改扁平表面。

- [ ] **Step 3: 验收**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/login.css`
Expected: 无输出

- [ ] **Step 4: 部署并验证 200**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/html/login.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/login.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
curl -sS -o /dev/null -w "%{http_code}\n" http://<VPS_IPV4>:18080/html/login.html
```

Expected: 200

### Task 7: 主页面迁移（index.html + app.html 片段）

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/app.css` `app-sidebar.css` `app-mailbox.css` `app-compose.css` `app-modal.css` `app-responsive.css` `app-mobile.css`
- Delete links to: `app_black.css` `app-mobile_black.css`；移除 `theme-toggle.js` 引用

- [ ] **Step 1: 修改 index.html head**

- 插入主题引导内联脚本
- 删除 Google Fonts 三个 link、`app_black.css`、`app-mobile_black.css`、`<script src="/js/theme-toggle.js">`
- 在页面 CSS 之前增加 `tokens.css`、`components.css`、`theme-switcher.css`
- 在 body 末尾增加 `<script src="/js/theme.js"></script>`

- [ ] **Step 2: 迁移 7 个 app 系 CSS**

按映射规则替换；`app-mobile.css` 与 `app-responsive.css` 一并处理。

- [ ] **Step 3: 验收**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/app.css public/css/app-sidebar.css public/css/app-mailbox.css public/css/app-compose.css public/css/app-modal.css public/css/app-responsive.css public/css/app-mobile.css`
Expected: 无输出

- [ ] **Step 4: 部署并验证**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/index.html root@<VPS_IPV4>:/opt/freemail-db-api/public/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/app.css public/css/app-sidebar.css public/css/app-mailbox.css public/css/app-compose.css public/css/app-modal.css public/css/app-responsive.css public/css/app-mobile.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
curl -sS -o /dev/null -w "%{http_code}\n" http://<VPS_IPV4>:18080/
```

Expected: 200

### Task 8: 邮件详情页迁移（mailbox.html）

**Files:**
- Modify: `public/html/mailbox.html`、`public/css/mailbox.css`
- Delete links to: `mailbox_black.css`

- [ ] **Step 1: 修改 mailbox.html head**

- `<head>` 开头插入与 Task 4 相同的主题引导内联脚本
- 删除 `<link rel="stylesheet" href="/css/mailbox_black.css" />` 与 Google Fonts 三个 link
- 在页面 CSS 之前增加 `<link rel="stylesheet" href="/css/tokens.css" />`、`/css/components.css`、`/css/theme-switcher.css`
- 若存在 `<script src="/js/theme-toggle.js"></script>` 则删除
- `<body>` 末尾增加 `<script src="/js/theme.js"></script>`

- [ ] **Step 2: 迁移 mailbox.css 到令牌**

按映射规则替换全部颜色/圆角/阴影/字体；删除渐变装饰改扁平表面。

- [ ] **Step 3: 验收**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/mailbox.css`
Expected: 无输出

- [ ] **Step 4: 部署并验证 200**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/html/mailbox.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/mailbox.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
curl -sS -o /dev/null -w "%{http_code}\n" http://<VPS_IPV4>:18080/html/mailbox.html
```

Expected: 200

### Task 9: 我的邮箱页迁移（mailboxes.html）

**Files:**
- Modify: `public/html/mailboxes.html`、`public/css/mailboxes.css` `public/css/mailboxes-toolbar.css` `public/css/mailboxes-subpage.css` `public/css/components/forms.css`
- Delete links to: `mailboxes_black.css`

- [ ] **Step 1: 修改 mailboxes.html head**

- `<head>` 开头插入与 Task 4 相同的主题引导内联脚本
- 删除 `<link rel="stylesheet" href="/css/mailboxes_black.css" />` 与 Google Fonts 三个 link
- 在页面 CSS 之前增加 `<link rel="stylesheet" href="/css/tokens.css" />`、`/css/components.css`、`/css/theme-switcher.css`
- 若存在 `<script src="/js/theme-toggle.js"></script>` 则删除
- `<body>` 末尾增加 `<script src="/js/theme.js"></script>`

- [ ] **Step 2: 迁移 4 个 CSS 到令牌**

按映射规则替换 `mailboxes.css`、`mailboxes-toolbar.css`、`mailboxes-subpage.css`、`components/forms.css` 中的全部颜色/圆角/阴影/字体。

- [ ] **Step 3: 验收**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/mailboxes.css public/css/mailboxes-toolbar.css public/css/mailboxes-subpage.css public/css/components/forms.css`
Expected: 无输出

- [ ] **Step 4: 部署并验证 200**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/html/mailboxes.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/mailboxes.css public/css/mailboxes-toolbar.css public/css/mailboxes-subpage.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/components/forms.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/components/
curl -sS -o /dev/null -w "%{http_code}\n" http://<VPS_IPV4>:18080/html/mailboxes.html
```

Expected: 200

### Task 10: 管理页迁移（admin.html）

**Files:**
- Modify: `public/html/admin.html`、`public/css/admin.css`
- Delete links to: `admin_black.css`

- [ ] **Step 1: 修改 admin.html head**

- `<head>` 开头插入与 Task 4 相同的主题引导内联脚本
- 删除 `<link rel="stylesheet" href="/css/admin_black.css" />` 与 Google Fonts 三个 link
- 在页面 CSS 之前增加 `<link rel="stylesheet" href="/css/tokens.css" />`、`/css/components.css`、`/css/theme-switcher.css`
- 若存在 `<script src="/js/theme-toggle.js"></script>` 则删除
- `<body>` 末尾增加 `<script src="/js/theme.js"></script>`

- [ ] **Step 2: 迁移 admin.css 到令牌**

按映射规则替换全部颜色/圆角/阴影/字体。

- [ ] **Step 3: 验收**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" public/css/admin.css`
Expected: 无输出

- [ ] **Step 4: 部署并验证 200**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/html/admin.html root@<VPS_IPV4>:/opt/freemail-db-api/public/html/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/admin.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
curl -sS -o /dev/null -w "%{http_code}\n" http://<VPS_IPV4>:18080/html/admin.html
```

Expected: 200

### Task 11: 全站收尾

- [ ] **Step 1: 确认无页面再引用 _black.css 或 theme-toggle.js**

```bash
grep -rn "_black.css\|theme-toggle.js" public/index.html public/html/*.html
```

Expected: 无输出

- [ ] **Step 2: 全站 HTTP 验证**

```bash
for path in / /html/login.html /html/mailbox.html /html/mailboxes.html /html/admin.html /theme-preview.html; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "http://<VPS_IPV4>:18080$path"
done
```

Expected: 全部 200

- [ ] **Step 3: 用户全站验收**

用户在浏览器依次检查 5 个页面 × 6 组合，确认后完成。

---

## 阶段 1 修订（用户验收反馈）

### Task 12: 风格差异强化

**背景:** 用户反馈三种风格差异不明显（此前仅强调色与圆角不同）。本任务从底色、形状、阴影、装饰四个维度拉开差异。

**Files:**
- Modify: `public/css/tokens.css`（全量替换为下方内容）
- Modify: `public/css/components.css`（4 处修改）
- Modify: `public/js/theme.js`（SWATCHES 色值更新）
- Modify: `tests/ui-tokens.test.mjs`（requiredTokens 增加 3 个新令牌）

**新增令牌:** `--btn-radius`、`--accent-glow`、`--focus-ring`（每个 combo 各 1 个）

- [ ] **Step 1: 更新 ui-tokens.test.mjs**

在 requiredTokens 数组中 `'--overlay'` 之后追加：

```js
  '--overlay', '--btn-radius', '--accent-glow', '--focus-ring'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/ui-tokens.test.mjs`
Expected: FAIL（新令牌未定义）

- [ ] **Step 3: 全量替换 tokens.css**

将 `public/css/tokens.css` 替换为以下完整内容：

```css
/* ============================================================
   Freemail 设计令牌
   3 风格 × 2 模式：calm/warm/tech × light/dark
   切换：<html data-style="..." data-mode="...">
   风格差异：底色 / 形状 / 阴影 / 装饰
   ============================================================ */

:root,
[data-style="calm"][data-mode="light"] {
  color-scheme: light;
  --bg: #f7f7f8;
  --surface: #ffffff;
  --surface-2: #f0f0f1;
  --text: #18181b;
  --text-2: #52525b;
  --text-3: #71717a;
  --border: #e8e8ea;
  --border-strong: #d4d4d8;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;
  --accent-contrast: #ffffff;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --btn-radius: 6px;
  --accent-glow: none;
  --focus-ring: 0 0 0 3px var(--accent-soft);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.06);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="calm"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #09090b;
  --surface: #18181b;
  --surface-2: #1f1f23;
  --text: #fafafa;
  --text-2: #d4d4d8;
  --text-3: #a1a1aa;
  --border: #27272a;
  --border-strong: #3f3f46;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-soft: #1e1b4b;
  --accent-contrast: #ffffff;
  --danger: #ef4444;
  --danger-soft: #2c1315;
  --success: #22c55e;
  --success-soft: #0f2417;
  --warning: #f59e0b;
  --warning-soft: #2b1f0a;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --btn-radius: 6px;
  --accent-glow: none;
  --focus-ring: 0 0 0 3px var(--accent-soft);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.4);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

[data-style="warm"][data-mode="light"] {
  color-scheme: light;
  --bg: #f7f2ea;
  --surface: #fffdfa;
  --surface-2: #f1ebe1;
  --text: #3d3226;
  --text-2: #6b5d4f;
  --text-3: #9a8a78;
  --border: #ece4d8;
  --border-strong: #ddd2c2;
  --accent: #ea580c;
  --accent-hover: #c2410c;
  --accent-soft: #ffedd5;
  --accent-contrast: #ffffff;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 20px;
  --btn-radius: 999px;
  --accent-glow: 0 6px 16px rgba(234, 88, 12, 0.22);
  --focus-ring: 0 0 0 3px var(--accent-soft);
  --shadow: 0 6px 20px rgba(180, 140, 90, 0.12);
  --shadow-lg: 0 16px 40px rgba(180, 140, 90, 0.18);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(60, 40, 20, 0.35);
}

[data-style="warm"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #211b15;
  --surface: #2b241d;
  --surface-2: #352d24;
  --text: #faf6f0;
  --text-2: #d8cdbf;
  --text-3: #a89a88;
  --border: #453b30;
  --border-strong: #5a4d3f;
  --accent: #fb923c;
  --accent-hover: #fdba74;
  --accent-soft: #431407;
  --accent-contrast: #211b15;
  --danger: #ef4444;
  --danger-soft: #2c1315;
  --success: #22c55e;
  --success-soft: #0f2417;
  --warning: #f59e0b;
  --warning-soft: #2b1f0a;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 20px;
  --btn-radius: 999px;
  --accent-glow: 0 6px 16px rgba(251, 146, 60, 0.28);
  --focus-ring: 0 0 0 3px var(--accent-soft);
  --shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.55);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.5);
}

[data-style="tech"][data-mode="dark"] {
  color-scheme: dark;
  --bg: #0a0e14;
  --surface: #11161f;
  --surface-2: #161c27;
  --text: #e6edf3;
  --text-2: #b3bcc7;
  --text-3: #8b949e;
  --border: #21262d;
  --border-strong: #30363d;
  --accent: #22d3ee;
  --accent-hover: #67e8f9;
  --accent-soft: #083344;
  --accent-contrast: #0a0e14;
  --danger: #f87171;
  --danger-soft: #2c1315;
  --success: #34d399;
  --success-soft: #0f2417;
  --warning: #fbbf24;
  --warning-soft: #2b1f0a;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --btn-radius: 4px;
  --accent-glow: 0 0 16px rgba(34, 211, 238, 0.35);
  --focus-ring: 0 0 0 3px var(--accent-soft), 0 0 12px rgba(34, 211, 238, 0.3);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.6);
}

[data-style="tech"][data-mode="light"] {
  color-scheme: light;
  --bg: #f2f6f9;
  --surface: #ffffff;
  --surface-2: #e8eef3;
  --text: #16202a;
  --text-2: #46525e;
  --text-3: #6b7a88;
  --border: #d0dae2;
  --border-strong: #aebcc8;
  --accent: #0891b2;
  --accent-hover: #0e7490;
  --accent-soft: #e0f5fa;
  --accent-contrast: #ffffff;
  --danger: #cf222e;
  --danger-soft: #fef2f2;
  --success: #1a7f37;
  --success-soft: #f0fdf4;
  --warning: #9a6700;
  --warning-soft: #fffbeb;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --btn-radius: 4px;
  --accent-glow: 0 0 12px rgba(8, 145, 178, 0.25);
  --focus-ring: 0 0 0 3px var(--accent-soft), 0 0 10px rgba(8, 145, 178, 0.25);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --overlay: rgba(0, 0, 0, 0.4);
}

/* 基础应用 */
html {
  background: var(--bg);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  transition: background-color 0.15s ease, color 0.15s ease;
}

/* Tech 风格：网格背景纹理 */
[data-style="tech"] body {
  background-image:
    linear-gradient(rgba(34, 211, 238, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34, 211, 238, 0.04) 1px, transparent 1px);
  background-size: 28px 28px;
}

[data-style="tech"][data-mode="light"] body {
  background-image:
    linear-gradient(rgba(8, 145, 178, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(8, 145, 178, 0.05) 1px, transparent 1px);
  background-size: 28px 28px;
}

* {
  scrollbar-color: var(--border-strong) transparent;
}
```

- [ ] **Step 4: 修改 components.css（4 处）**

4a. `.btn` 的 `border-radius: var(--radius-md);` 改为 `border-radius: var(--btn-radius);`

4b. `.btn-primary` 增加一行 `box-shadow: var(--accent-glow);`（放在 `color` 行之后）

4c. `.input:focus, .select:focus, textarea.input:focus` 中的 `box-shadow: 0 0 0 3px var(--accent-soft);` 改为 `box-shadow: var(--focus-ring);`

4d. 文件末尾追加：

```css
/* ---------- 风格差异强化 ---------- */
[data-style="warm"] .card {
  border-color: transparent;
}

[data-style="tech"] .badge-accent {
  font-family: var(--font-mono);
}
```

- [ ] **Step 5: 更新 theme.js SWATCHES**

将 `var SWATCHES = {` 块替换为：

```js
  var SWATCHES = {
    calm: ['#f7f7f8', '#4f46e5', '#18181b'],
    warm: ['#f7f2ea', '#ea580c', '#3d3226'],
    tech: ['#0a0e14', '#22d3ee', '#e6edf3']
  };
```

- [ ] **Step 6: 运行全部 UI 测试**

Run: `node tests/ui-tokens.test.mjs && node tests/ui-theme-js.test.mjs && node tests/ui-components.test.mjs && node tests/ui-preview-page.test.mjs`
Expected: 4 个测试全部通过

- [ ] **Step 7: 部署并验证**

```bash
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/css/tokens.css public/css/components.css root@<VPS_IPV4>:/opt/freemail-db-api/public/css/
scp -i ~/.ssh/<SSH_KEY> -P <SSH_PORT> public/js/theme.js root@<VPS_IPV4>:/opt/freemail-db-api/public/js/
for path in /theme-preview.html /css/tokens.css /css/components.css /js/theme.js; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "http://<VPS_IPV4>:18080$path"
done
```

Expected: 全部 200

- [ ] **Step 8: 用户重新验收**

用户打开预览页重新对比 6 种组合。
