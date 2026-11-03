const ALLOWED_TAGS = new Set([
  'a', 'p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'img', 'font', 'center', 'small', 'big', 'sub', 'sup', 'dl', 'dt', 'dd', 'figure', 'figcaption'
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align', 'valign',
  'style', 'class', 'bgcolor', 'color', 'face', 'size', 'border', 'cellpadding', 'cellspacing'
]);

const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select',
  'textarea', 'meta', 'link', 'base', 'svg', 'math', 'template', 'noscript'
]);

function isSafeUrl(value, allowDataImage) {
  const normalized = String(value || '').replace(/[\u0000-\u0020]+/g, '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:text/html')) return false;
  if (allowDataImage && normalized.startsWith('data:image/')) return true;
  return /^(https?:|mailto:|tel:|cid:|\/|#)/i.test(normalized);
}

const MAX_DEPTH = 200;
const MAX_NODES = 20000;

export function sanitizeHtml(html, options = {}) {
  if (!html) return '';
  const allowStyles = options.allowStyles !== false;
  const template = document.createElement('template');
  template.innerHTML = String(html);

  let nodeCount = 0;

  const sanitizeElement = (el, depth) => {
    nodeCount += 1;
    if (depth > MAX_DEPTH || nodeCount > MAX_NODES) {
      el.remove();
      return;
    }

    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (DANGEROUS_TAGS.has(tag)) {
        el.remove();
        return;
      }
      const parent = el.parentNode;
      if (!parent) return;
      const moved = [];
      while (el.firstChild) {
        const child = el.firstChild;
        if (child.nodeType === 1) moved.push(child);
        parent.insertBefore(child, el);
      }
      el.remove();
      for (const child of moved) sanitizeElement(child, depth);
      return;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowStyles && (name === 'style' || name === 'class')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && !isSafeUrl(attr.value, false)) el.removeAttribute(attr.name);
      if (name === 'src' && !isSafeUrl(attr.value, true)) el.removeAttribute(attr.name);
    }

    for (const child of Array.from(el.children)) sanitizeElement(child, depth + 1);
  };

  for (const el of Array.from(template.content.children)) sanitizeElement(el, 0);
  return template.innerHTML;
}
