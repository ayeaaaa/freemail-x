import { extractEmail, normalizeEmailAlias } from './utils/common.js';
import { forwardByLocalPart } from './email/forwarder.js';
import { parseEmailBody, extractVerificationCode } from './email/parser.js';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

function buildIngressHeaders(env) {
  const token = String(env.DB_API_TOKEN || '').trim();
  if (!token) throw new Error('未配置 DB_API_TOKEN');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

async function storeInboundEmail(payload, env) {
  const endpoint = String(env.DB_API_URL || '').trim().replace(/\/$/, '');
  if (!endpoint) throw new Error('未配置 DB_API_URL');
  const resp = await fetch(`${endpoint}/inbound-email`, {
    method: 'POST',
    headers: buildIngressHeaders(env),
    body: JSON.stringify(payload)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.success === false) {
    throw new Error(data.error || `inbound-email failed: ${resp.status}`);
  }
  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse({ ok: true, service: 'freemail-mail-chain' });
    }

    return new Response('Not Found', { status: 404 });
  },

  async email(message, env, ctx) {
    try {
      const headers = message.headers;
      const toHeader = headers.get('to') || headers.get('To') || '';
      const fromHeader = headers.get('from') || headers.get('From') || '';
      const subject = headers.get('subject') || headers.get('Subject') || '(无主题)';

      let envelopeTo = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue) && toValue.length > 0) {
          envelopeTo = typeof toValue[0] === 'string' ? toValue[0] : (toValue[0].address || '');
        } else if (typeof toValue === 'string') {
          envelopeTo = toValue;
        }
      } catch (_) {}

      const resolvedRecipient = (envelopeTo || toHeader || '').toString();
      const resolvedRecipientAddr = extractEmail(resolvedRecipient);
      const normalizedRecipientAddr = normalizeEmailAlias(resolvedRecipientAddr).toLowerCase();
      const localPart = (normalizedRecipientAddr.split('@')[0] || '').toLowerCase();
      const sender = extractEmail(fromHeader).toLowerCase();

      // 保留原有基于前缀的可选转发规则
      forwardByLocalPart(message, localPart, ctx, env);

      let textContent = '';
      let htmlContent = '';
      let rawBuffer = null;
      try {
        const resp = new Response(message.raw);
        rawBuffer = await resp.arrayBuffer();
        const rawText = await new Response(rawBuffer).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
        if (!textContent && !htmlContent) textContent = (rawText || '').slice(0, 100000);
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = normalizedRecipientAddr || normalizeEmailAlias(extractEmail(toHeader)).toLowerCase();

      const preview = (() => {
        const plain = textContent && textContent.trim() ? textContent : (htmlContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return String(plain || '').slice(0, 120);
      })();

      let verificationCode = '';
      try {
        verificationCode = extractVerificationCode({ subject, text: textContent, html: htmlContent });
      } catch (_) {}

      let toAddrs = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue)) {
          toAddrs = toValue.map(v => (typeof v === 'string' ? v : (v?.address || ''))).filter(Boolean).join(',');
        } else if (typeof toValue === 'string') {
          toAddrs = toValue;
        } else {
          toAddrs = resolvedRecipient || toHeader || '';
        }
      } catch (_) {
        toAddrs = resolvedRecipient || toHeader || '';
      }

      await storeInboundEmail({
        mailbox,
        sender,
        to_addrs: String(toAddrs || ''),
        subject: subject || '(无主题)',
        verification_code: verificationCode || null,
        preview: preview || null,
        r2_bucket: null,
        r2_object_key: null,
        content: textContent || null,
        html_content: htmlContent || null
      }, env);
    } catch (err) {
      console.error('Mail-chain worker email error:', err);
    }
  }
};
