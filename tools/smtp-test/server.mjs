import { SMTPServer } from 'smtp-server';
import { extractVerificationCode } from './extract-code.mjs';

const PORT = Number(process.env.SMTP_PORT || 25);
const HOST = String(process.env.SMTP_HOST || '0.0.0.0').trim();
const DB_API_URL = String(process.env.DB_API_URL || '').trim().replace(/\/$/, '');
const DB_API_TOKEN = String(process.env.DB_API_TOKEN || '').trim();

if (!DB_API_URL || !DB_API_TOKEN) {
  throw new Error('Missing DB_API_URL or DB_API_TOKEN');
}

function extractEmail(addr) {
  const s = String(addr || '').trim();
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return s.split(/\s/)[0] || s;
}

function normalizeEmailAlias(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return '';
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return normalized;
  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const lastSeparatorIndex = Math.max(
    localPart.lastIndexOf('.'),
    localPart.lastIndexOf('+'),
    localPart.lastIndexOf('-')
  );
  if (lastSeparatorIndex <= 0) return normalized;
  const realLocalPart = localPart.slice(lastSeparatorIndex + 1);
  return realLocalPart ? `${realLocalPart}@${domain}` : normalized;
}

function parseHeaders(rawHeaders) {
  const headers = new Map();
  const lines = String(rawHeaders || '').split(/\r?\n/);
  let lastKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && lastKey) {
      headers.set(lastKey, `${headers.get(lastKey) || ''} ${line.trim()}`.trim());
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    lastKey = match[1].toLowerCase();
    headers.set(lastKey, match[2]);
  }
  return headers;
}

function splitHeadersAndBody(raw) {
  const crlfIndex = raw.indexOf('\r\n\r\n');
  const lfIndex = crlfIndex === -1 ? raw.indexOf('\n\n') : crlfIndex;
  if (lfIndex === -1) return { rawHeaders: raw, body: '' };
  const separator = crlfIndex !== -1 ? 4 : 2;
  return {
    rawHeaders: raw.slice(0, lfIndex),
    body: raw.slice(lfIndex + separator)
  };
}

function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const { rawHeaders, body } = splitHeadersAndBody(raw);
  return parseEntity(parseMimeHeaders(rawHeaders), body);
}

function parseMimeHeaders(rawHeaders) {
  const headers = {};
  const lines = String(rawHeaders || '').split(/\r?\n/);
  let lastKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && lastKey) {
      headers[lastKey] += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    lastKey = match[1].toLowerCase();
    headers[lastKey] = match[2];
  }
  return headers;
}

function parseEntity(headers, body) {
  const contentTypeRaw = headers['content-type'] || '';
  const contentType = contentTypeRaw.toLowerCase();
  const transferEncoding = (headers['content-transfer-encoding'] || '').toLowerCase();
  const boundaryMatch = contentTypeRaw.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  const boundary = boundaryMatch ? boundaryMatch[1].trim() : '';

  if (!contentType.startsWith('multipart/')) {
    const decoded = decodeBodyWithCharset(body, transferEncoding, contentType);
    const isHtml = contentType.includes('text/html');
    const isText = contentType.includes('text/plain') || !isHtml;
    return { text: isText ? decoded : '', html: isHtml ? decoded : '' };
  }

  let text = '';
  let html = '';
  if (boundary) {
    const delimiter = `--${boundary}`;
    const endDelimiter = `--${boundary}--`;
    const parts = [];
    let current = [];
    let inPart = false;
    for (const line of body.split(/\r?\n/)) {
      if (line.trim() === delimiter) {
        if (inPart && current.length) parts.push(current.join('\n'));
        current = [];
        inPart = true;
        continue;
      }
      if (line.trim() === endDelimiter) {
        if (inPart && current.length) parts.push(current.join('\n'));
        break;
      }
      if (inPart) current.push(line);
    }

    for (const part of parts) {
      const { rawHeaders: partHeaders, body: partBody } = splitHeadersAndBody(part);
      const nested = parseEntity(parseMimeHeaders(partHeaders), partBody);
      if (!text && nested.text) text = nested.text;
      if (!html && nested.html) html = nested.html;
      if (text && html) break;
    }
  }

  if (!html && text) {
    html = `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
  }
  return { text, html };
}

function decodeBodyBytes(body, transferEncoding) {
  if (!body) return Buffer.alloc(0);
  if (transferEncoding === 'base64') {
    return Buffer.from(String(body).replace(/\s+/g, ''), 'base64');
  }
  if (transferEncoding === 'quoted-printable') {
    const normalized = String(body).replace(/=\r?\n/g, '');
    const bytes = Buffer.alloc(normalized.length);
    let out = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      const ch = normalized[i];
      if (ch === '=' && i + 2 < normalized.length && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(i + 1, i + 3))) {
        bytes[out] = parseInt(normalized.slice(i + 1, i + 3), 16);
        out += 1;
        i += 2;
      } else {
        bytes[out] = normalized.charCodeAt(i) & 0xff;
        out += 1;
      }
    }
    return bytes.subarray(0, out);
  }
  return Buffer.from(String(body), 'utf8');
}

function decodeBodyWithCharset(body, transferEncoding, contentType) {
  if (!body) return '';
  const bytes = decodeBodyBytes(body, transferEncoding);
  const match = /charset\s*=\s*"?([^";]+)/i.exec(contentType || '');
  const charset = (match && match[1] ? match[1].trim().toLowerCase() : '') || 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function decodeMimeHeader(value) {
  const joined = String(value || '').replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (match, charset, encoding, text) => {
    try {
      let bytes;
      if (encoding.toUpperCase() === 'B') {
        bytes = Buffer.from(text, 'base64');
      } else {
        const normalized = text.replace(/_/g, ' ');
        bytes = Buffer.alloc(normalized.length);
        let out = 0;
        for (let i = 0; i < normalized.length; i += 1) {
          const ch = normalized[i];
          if (ch === '=' && i + 2 < normalized.length && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(i + 1, i + 3))) {
            bytes[out] = parseInt(normalized.slice(i + 1, i + 3), 16);
            out += 1;
            i += 2;
          } else {
            bytes[out] = normalized.charCodeAt(i) & 0xff;
            out += 1;
          }
        }
        bytes = bytes.subarray(0, out);
      }
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      return match;
    }
  });
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

async function storeInboundEmail(payload) {
  const response = await fetch(`${DB_API_URL}/inbound-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DB_API_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || `inbound-email failed: ${response.status}`);
  }
}

const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  authOptional: true,
  size: 25 * 1024 * 1024,
  onRcptTo(address, session, callback) {
    if (!address?.address) {
      callback(new Error('Missing recipient'));
      return;
    }
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    let sizeExceeded = false;
    stream.on('data', (chunk) => {
      if (sizeExceeded) return;
      if (stream.sizeExceeded) {
        sizeExceeded = true;
        chunks.length = 0;
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on('error', callback);
    stream.on('end', async () => {
      if (sizeExceeded || stream.sizeExceeded) {
        const error = new Error('Message size exceeds the 25MB limit');
        error.responseCode = 552;
        callback(error);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const { rawHeaders } = splitHeadersAndBody(raw);
        const headers = parseHeaders(rawHeaders);
        const parsed = parseEmailBody(raw);

        const recipient = session.envelope?.rcptTo?.[0]?.address || headers.get('to') || '';
        const mailbox = normalizeEmailAlias(extractEmail(recipient)).toLowerCase();
        const sender = extractEmail(session.envelope?.mailFrom?.address || headers.get('from') || '').toLowerCase();
        const subject = decodeMimeHeader(headers.get('subject') || '(no subject)');
        const toAddrs = (session.envelope?.rcptTo || []).map((item) => item.address).filter(Boolean).join(',') || recipient;
        const textContent = parsed.text || '';
        const htmlContent = parsed.html || '';
        const previewSource = textContent.trim() ? textContent : htmlContent.replace(/<[^>]+>/g, ' ');
        const preview = previewSource.replace(/\s+/g, ' ').trim().slice(0, 120);
        const verificationCode = extractVerificationCode({
          subject,
          text: textContent,
          html: htmlContent
        }) || null;

        await storeInboundEmail({
          mailbox,
          sender,
          to_addrs: toAddrs,
          subject,
          verification_code: verificationCode,
          preview: preview || null,
          r2_bucket: null,
          r2_object_key: null,
          content: textContent || null,
          html_content: htmlContent || null
        });

        console.log(JSON.stringify({ ok: true, mailbox, sender, subject }));
        callback();
      } catch (error) {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        callback(error);
      }
    });
  }
});

server.on('error', (error) => {
  console.error(JSON.stringify({ ok: false, scope: 'smtp-server', error: String(error?.message || error) }));
});

server.listen({ port: PORT, host: HOST }, () => {
  console.log(`SMTP ingress listening on ${HOST}:${PORT}`);
});
