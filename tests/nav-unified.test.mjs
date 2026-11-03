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
  assert.ok(html.includes('href="/index.html"'), page + ' must contain 首页 link to /index.html');
  assert.ok(!html.includes('href="/"'), page + ' must not link 首页 to the public page');
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
