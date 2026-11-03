import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes('function generateAccessCode()'), 'backend must define generateAccessCode');
assert.ok(server.includes('async function generateUniqueAccessCode(client)'), 'backend must pre-check access code uniqueness');
assert.ok(server.includes('SELECT id, access_code FROM mailboxes WHERE address = $1'), 'getOrCreateMailbox must read access_code');
assert.ok(
  server.includes('VALUES ($1, $2, $3, NULL, CURRENT_TIMESTAMP, $4) ON CONFLICT (address) DO NOTHING'),
  'mailbox insert must persist access_code'
);
assert.ok(server.includes('access_code: mailbox.accessCode'), 'create/generate responses must include access_code');
assert.ok(server.includes('info.access_code = result.rows[0].access_code || null'), 'mailbox info must include access_code');
assert.ok(server.includes("payload.role !== 'admin'"), 'access_code must be stripped for non-admin sessions');
assert.ok(server.includes("if (payload.role === 'admin') info.access_code"), 'mailbox info must gate access_code to admin');
assert.ok(server.includes('SELECT id, address, access_code, created_at'), 'mailbox list must select access_code');

console.log('access-code: all assertions passed');
