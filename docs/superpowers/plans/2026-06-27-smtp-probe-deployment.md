# SMTP Probe Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify public SMTP reception on TCP port 25 for `<VPS_IPV4>` before deploying Freemail.

**Architecture:** Deploy a standalone Node SMTP probe under `/opt/freemail-smtp-probe`. The probe accepts SMTP transactions on `0.0.0.0:25` and appends only sender, recipient, subject, remote IP, and byte count to a local JSONL log; it does not depend on Freemail or PostgreSQL.

**Tech Stack:** Node.js, `smtp-server`, systemd, TCP/SMTP protocol checks.

## Global Constraints

- Target server: `<VPS_IPV4>`, SSH port `57222`.
- SMTP listener: `0.0.0.0:25`.
- Service: `freemail-smtp-probe.service`.
- Install directory: `/opt/freemail-smtp-probe`.
- Log file: `/var/log/freemail-smtp-probe/received.log`.
- Do not store message bodies, SMTP credentials, or raw headers.

---

### Task 1: Deploy SMTP Probe

**Files:**
- Create: `/opt/freemail-smtp-probe/package.json`
- Create: `/opt/freemail-smtp-probe/server.mjs`
- Create: `/etc/systemd/system/freemail-smtp-probe.service`
- Create: `/var/log/freemail-smtp-probe/received.log`

**Interfaces:**
- Consumes: SMTP client connections on TCP port 25.
- Produces: SMTP `220` greeting and JSONL metadata records in `received.log`.

- [ ] **Step 1: Write the failing local listener check**

Run on the target server before deployment:

```bash
timeout 5 bash -c '</dev/tcp/127.0.0.1/25'
```

Expected: non-zero exit because no SMTP listener is installed.

- [ ] **Step 2: Create the probe package manifest**

Create `/opt/freemail-smtp-probe/package.json`:

```json
{
  "name": "freemail-smtp-probe",
  "private": true,
  "type": "module",
  "dependencies": {
    "smtp-server": "^3.13.6"
  }
}
```

- [ ] **Step 3: Create the probe server**

Create `/opt/freemail-smtp-probe/server.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';

const port = 25;
const logFile = '/var/log/freemail-smtp-probe/received.log';

function extractAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function extractSubject(raw) {
  const match = String(raw || '').match(/^subject:\s*(.*)$/im);
  return match ? match[1].trim().slice(0, 500) : '';
}

function appendRecord(record) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
}

const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  authOptional: true,
  onRcptTo(address, session, callback) {
    callback(address?.address ? null : new Error('Missing recipient'));
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', callback);
    stream.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        appendRecord({
          type: 'smtp-received',
          ts: new Date().toISOString(),
          remoteAddress: session.remoteAddress || '',
          sender: extractAddress(session.envelope?.mailFrom?.address),
          recipients: (session.envelope?.rcptTo || []).map((item) => extractAddress(item.address)).filter(Boolean),
          subject: extractSubject(raw.toString('utf8')),
          bytes: raw.length
        });
        callback();
      } catch (error) {
        callback(error);
      }
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`freemail SMTP probe listening on ${port}`);
});
```

- [ ] **Step 4: Install dependencies and create systemd service**

Run:

```bash
cd /opt/freemail-smtp-probe
npm install --omit=dev
cat >/etc/systemd/system/freemail-smtp-probe.service <<'EOF'
[Unit]
Description=Freemail SMTP Port 25 Probe
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/freemail-smtp-probe
ExecStart=/usr/bin/node /opt/freemail-smtp-probe/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now freemail-smtp-probe
```

- [ ] **Step 5: Verify local listener and protocol greeting**

Run:

```bash
systemctl is-active freemail-smtp-probe
ss -ltnp | grep ':25'
python3 - <<'PY'
import socket
s = socket.create_connection(('127.0.0.1', 25), timeout=5)
print(s.recv(512).decode('utf-8', 'replace'))
s.sendall(b'QUIT\r\n')
s.close()
PY
```

Expected: service is `active`, listener is `0.0.0.0:25`, and greeting starts with `220`.

### Task 2: Verify Public SMTP Reception

**Files:**
- Verify: `/var/log/freemail-smtp-probe/received.log`

**Interfaces:**
- Consumes: public SMTP connection to `<VPS_IPV4>:25`.
- Produces: a matching `smtp-received` JSONL entry.

- [ ] **Step 1: Verify external SMTP banner**

Run from an external host:

```bash
python3 - <<'PY'
import socket
s = socket.create_connection(('<VPS_IPV4>', 25), timeout=10)
print(s.recv(512).decode('utf-8', 'replace'))
s.sendall(b'QUIT\r\n')
s.close()
PY
```

Expected: greeting starts with `220`.

- [ ] **Step 2: Send a complete external SMTP test transaction**

Run:

```bash
python3 - <<'PY'
import socket
s = socket.create_connection(('<VPS_IPV4>', 25), timeout=10)
def read():
    print(s.recv(1024).decode('utf-8', 'replace'))
def send(line):
    s.sendall((line + '\r\n').encode())
    read()
read()
send('EHLO smtp-probe-test.example')
send('MAIL FROM:<sender@example.com>')
send('RCPT TO:<probe@freemail-test.example>')
send('DATA')
s.sendall(b'Subject: Freemail SMTP probe\r\n\r\nSMTP probe body.\r\n.\r\n')
read()
send('QUIT')
s.close()
PY
```

Expected: SMTP responses include `250` after DATA and `221` after QUIT.

- [ ] **Step 3: Verify receipt metadata and service state**

Run on the target server:

```bash
tail -1 /var/log/freemail-smtp-probe/received.log
systemctl show freemail-smtp-probe -p ActiveState -p SubState -p MainPID -p NRestarts
```

Expected: a JSON record containing `type: "smtp-received"`, the test sender, the test recipient, subject `Freemail SMTP probe`, and service state `active/running`.
