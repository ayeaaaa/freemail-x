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
