/**
 * 邮件验证码提取（SMTP ingress 共用模块）
 * 部署时需与 server.mjs 一起复制到 /opt/freemail-smtp-ingress/。
 */

function removeTagBlocks(input, openToken, closeToken) {
  const source = String(input || '');
  const lower = source.toLowerCase();
  let output = '';
  let cursor = 0;
  while (true) {
    const start = lower.indexOf(openToken, cursor);
    if (start === -1) {
      output += source.slice(cursor);
      return output;
    }
    output += source.slice(cursor, start);
    const close = lower.indexOf(closeToken, start + openToken.length);
    if (close === -1) {
      output += source.slice(start);
      return output;
    }
    cursor = close + closeToken.length;
  }
}

function stripHtml(html) {
  let text = String(html || '');
  text = removeTagBlocks(text, '<script', '</script>');
  text = removeTagBlocks(text, '<style', '</style>');
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractVerificationCode({ subject = '', text = '', html = '' } = {}) {
  const body = `${String(text || '')} ${stripHtml(html)}`.trim();
  const sources = [String(subject || ''), body];
  const keywords = '(?:verification|one[-\\s]?time|two[-\\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認證碼)';
  // 关键词不能是标识符的一部分（如 via_launch_code_email 里的 code）
  const keywordLeft = '(?<![0-9A-Za-z_])';
  // 数字段不能是更长字母数字令牌的一部分（如 UUID 04312798-1fd6-... 的片段）
  const digitRun = '([0-9][0-9\\s\\-_.]{3,15})';
  const digitRunRight = '(?![0-9A-Za-z_-])';
  const patterns = [
    // 1) 关键词在前：允许数字跨换行出现（“code below:\n\n64441325” 这类排版）
    new RegExp(`${keywordLeft}${keywords}[^\\d]{0,30}${digitRun}${digitRunRight}`, 'i'),
    // 2) 数字在前
    new RegExp(`${keywordLeft}${digitRun}${digitRunRight}[^\\d]{0,30}${keywordLeft}${keywords}`, 'i')
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
