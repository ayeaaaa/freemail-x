import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/admin.css', import.meta.url), 'utf8');

const colsRule = css.match(/\.admin-left,\s*\.admin-right\s*\{([^}]*)\}/);
assert.ok(colsRule, 'admin.css must define .admin-left/.admin-right');
assert.ok(
  /min-width:\s*0/.test(colsRule[1]),
  '.admin-left/.admin-right must set min-width: 0 so the 600px table scrolls inside its wrapper instead of widening the mobile layout viewport'
);

assert.ok(
  /@media\s*\(max-width:\s*768px\)[\s\S]*?\.table-wrapper\s*\{[^}]*overflow-x:\s*auto/.test(css),
  'mobile media query must make .table-wrapper scroll horizontally'
);

console.log('admin-mobile: all assertions passed');
