import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseServerTime, formatTime, formatRelativeTime } from '../public/js/core/utils.js';
import { formatTs, formatTsMobile } from '../public/js/modules/app/ui-helpers.js';
import { formatTime as formatMailboxTime, sortEmails } from '../public/js/modules/mailbox/email-list.js';
import { formatTime as formatRenderTime } from '../public/js/modules/mailboxes/render.js';
import { formatTime as formatGridTime } from '../public/js/modules/mailboxes/grid-view.js';
import { sortMailboxes } from '../public/js/modules/mailboxes/filters.js';
import { formatTime as formatUserTime } from '../public/js/modules/admin/user-list.js';

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

const emailViewerSrc = fs.readFileSync(new URL('../public/js/modules/app/email-viewer.js', import.meta.url), 'utf8');
assert.ok(emailViewerSrc.includes("from '../../core/utils.js'"), 'email-viewer.js must import parseServerTime');
assert.ok(emailViewerSrc.includes('parseServerTime(email.received_at)'), 'email-viewer.js must use parseServerTime');

const composeSrc = fs.readFileSync(new URL('../public/js/modules/app/compose.js', import.meta.url), 'utf8');
assert.ok(composeSrc.includes('formatTs'), 'compose.js must use formatTs for sent time');
assert.ok(!composeSrc.includes('escapeHtml(e.created_at || ' + "''" + ')'), 'compose.js must not render raw created_at');

console.log('time-format core: all assertions passed');
