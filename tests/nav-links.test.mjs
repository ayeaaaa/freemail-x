import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../public/', import.meta.url);
const htmlFiles = [
  'index.html',
  'html/app.html',
  'html/admin.html',
  'html/mailbox.html',
  'html/mailboxes.html',
  'html/login.html',
  'html/domain-migrate.html',
  'templates/loading.html'
];

let checked = 0;
for (const file of htmlFiles) {
  const content = fs.readFileSync(new URL(file, root), 'utf8');
  const matches = [...content.matchAll(/redirect=([^&"'\s]+)/g)];
  for (const match of matches) {
    const target = decodeURIComponent(match[1]);
    if (!target.startsWith('/') || target === '/') continue;
    const clean = target.split('?')[0].split('#')[0];
    const filePath = clean.replace(/^\//, '');
    const exists = fs.existsSync(new URL(filePath, root));
    assert.ok(exists, `${file}: redirect target ${target} does not exist under public/`);
    checked++;
  }
}

assert.ok(checked >= 4, `expected at least 4 redirect targets checked, got ${checked}`);
console.log(`nav-links: all assertions passed (${checked} redirect targets checked)`);
