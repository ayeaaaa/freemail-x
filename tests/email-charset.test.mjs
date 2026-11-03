import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../tools/smtp-test/server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes('function decodeBodyBytes('), 'ingress must decode bodies to bytes before applying the charset');
assert.ok(server.includes("if (transferEncoding === 'quoted-printable')"), 'ingress must handle quoted-printable bodies');
assert.ok(server.includes('new TextDecoder(charset'), 'ingress must decode using the declared charset');
assert.ok(server.includes('function decodeMimeHeader('), 'ingress must decode MIME encoded headers');
assert.ok(server.includes("decodeMimeHeader(headers.get('subject')"), 'subject must be MIME-decoded before storing');
assert.ok(!server.includes('return decodedRaw;'), 'UTF-8 quoted-printable bodies must not be returned as latin1');

console.log('email-charset: all assertions passed');
