import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../.remote-freemail-server.mjs', import.meta.url), 'utf8');
assert.ok(server.includes("pathname === '/' ? '/lookup.html' : pathname"), 'root must serve lookup.html');

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(!index.includes("redirect=/')"), 'index.html must not redirect to the public page');
assert.ok(index.includes("redirect=/index.html')"), 'index.html must redirect back to /index.html');

const login = fs.readFileSync(new URL('../public/js/login.js', import.meta.url), 'utf8');
assert.ok(login.includes("return t || '/index.html'"), 'login default target must be /index.html');
assert.ok(!login.includes("location.replace('/')"), 'login must not navigate to the public page');

const guard = fs.readFileSync(new URL('../public/js/auth-guard.js', import.meta.url), 'utf8');
assert.ok(!guard.includes("window.location.replace('/')"), 'auth guard must not navigate to the public page');
assert.ok(guard.includes("window.location.replace('/index.html')"), 'auth guard fallback must be /index.html');

const loading = fs.readFileSync(new URL('../public/templates/loading.html', import.meta.url), 'utf8');
assert.ok(!loading.includes("location.replace('/')"), 'loading fallback must not navigate to the public page');
assert.ok(loading.includes("location.replace('/index.html')"), 'loading fallback must be /index.html');

const loginHtml = fs.readFileSync(new URL('../public/html/login.html', import.meta.url), 'utf8');
assert.ok(!loginHtml.includes("location.replace('/')"), 'login page prechecks must not redirect to the public page');
assert.ok(loginHtml.includes("location.replace('/index.html')"), 'login page prechecks must redirect to /index.html');

const guardSrc = fs.readFileSync(new URL('../public/js/auth-guard.js', import.meta.url), 'utf8');
assert.ok(!guardSrc.includes("|| '/'"), 'auth-guard root defaults must be /index.html');
assert.ok(!guardSrc.includes("var target = '/';"), 'auth-guard target defaults must be /index.html');

const mailboxesJs = fs.readFileSync(new URL('../public/js/mailboxes.js', import.meta.url), 'utf8');
assert.ok(!mailboxesJs.includes('/?mailbox='), 'mailbox click-through must target /index.html');
assert.ok(mailboxesJs.includes('/index.html?mailbox='), 'mailbox click-through must include /index.html');

const appHtml = fs.readFileSync(new URL('../public/html/app.html', import.meta.url), 'utf8');
assert.ok(!appHtml.includes('href="/"'), 'app nav home must target /index.html');
assert.ok(appHtml.includes('href="/index.html"'), 'app nav home must include /index.html');

assert.ok(!loading.includes("|| '/'"), 'loading redirect default must be /index.html');
assert.ok(loading.includes("|| '/index.html'"), 'loading redirect default must be /index.html');
assert.ok(!guardSrc.includes("return '/'"), 'auth-guard hash fallback must not return the public page');
assert.ok(guardSrc.includes("return '/index.html'"), 'auth-guard hash fallback must be /index.html');
assert.ok(guardSrc.includes("if (redirectParam === '/' || redirectParam === '/html/app.html') redirectParam = '/index.html';"), 'auth-guard must normalize legacy root redirects');
assert.ok(guardSrc.includes("if (redirectParam === '/index.html' && hashToUse)"), 'auth-guard must only append hash to /index.html');
assert.ok(loading.includes("t === '/' || t === '/html/app.html'"), 'loading must normalize legacy root redirects');
assert.ok(login.includes("if (target === '/' || target === '/html/app.html') target = '/index.html';"), 'login must normalize legacy root redirects');

console.log('default-page-redirects: all assertions passed');
