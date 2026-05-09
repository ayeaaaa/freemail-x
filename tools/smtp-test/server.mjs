import { SMTPServer } from 'smtp-server';

const PORT = Number(process.env.SMTP_PORT || 25);
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

function decodeBodyWithCharset(body, transferEncoding, contentType) {
  const decodedRaw = decodeBody(body, transferEncoding);
  const match = /charset\s*=\s*"?([^";]+)/i.exec(contentType || '');
  const charset = (match && match[1] ? match[1].trim().toLowerCase() : '') || 'utf-8';
  if (!decodedRaw) return '';
  if (charset === 'utf-8' || charset === 'utf8' || charset === 'us-ascii') return decodedRaw;
  try {
    const bytes = new Uint8Array(decodedRaw.split('').map((char) => char.charCodeAt(0)));
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return decodedRaw;
  }
}

function decodeBody(body, transferEncoding) {
  if (!body) return '';
  if (transferEncoding === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return body;
    }
  }
  if (transferEncoding === 'quoted-printable') {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
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

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVerificationCode({ subject = '', text = '', html = '' } = {}) {
  const body = `${String(text || '')} ${stripHtml(html)}`.trim();
  const sources = [String(subject || ''), body];
  const patterns = [
    /(?:verification|one[-\s]?time|two[-\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認證碼)[^\n\r\d]{0,30}([0-9][0-9\s\-_.]{3,15})/i,
    /([0-9][0-9\s\-_.]{3,15})[^\n\r\d]{0,30}(?:verification|one[-\s]?time|two[-\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認證碼)/i
  ];
  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match || !match[1]) continue;
      const digits = match[1].replace(/\D+/g, '');
      if (digits.length >= 4 && digits.length <= 8) return digits;
    }
  }
  return '';
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
  onRcptTo(address, session, callback) {
    if (!address?.address) {
      callback(new Error('Missing recipient'));
      return;
    }
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', callback);
    stream.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const { rawHeaders } = splitHeadersAndBody(raw);
        const headers = parseHeaders(rawHeaders);
        const parsed = parseEmailBody(raw);

        const recipient = session.envelope?.rcptTo?.[0]?.address || headers.get('to') || '';
        const mailbox = normalizeEmailAlias(extractEmail(recipient)).toLowerCase();
        const sender = extractEmail(session.envelope?.mailFrom?.address || headers.get('from') || '').toLowerCase();
        const subject = headers.get('subject') || '(no subject)';
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SMTP ingress listening on ${PORT}`);
});
