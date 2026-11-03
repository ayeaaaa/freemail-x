import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = ['html/app.html', 'html/admin.html', 'html/mailboxes.html', 'html/mailbox.html'];

for (const page of pages) {
  const html = fs.readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
  const brandMatch = html.match(/<div class="brand">([\s\S]*?)<\/div>/);
  assert.ok(brandMatch, page + ' must have a .brand block');
  assert.ok(
    brandMatch[1].includes('class="brand-text"'),
    page + ' brand text must use .brand-text class so mobile CSS can hide it'
  );
}

console.log('brand-text: all assertions passed');
