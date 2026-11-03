import { sanitizeHtml } from './core/sanitize.js';
import { formatTime, escapeHtml } from './core/utils.js';
import { copyText } from './modules/app/ui-helpers.js';

const els = {
  form: document.getElementById('lookup-form'),
  input: document.getElementById('access-code-input'),
  boxes: Array.from(document.querySelectorAll('.code-box')),
  btn: document.getElementById('lookup-btn'),
  error: document.getElementById('lookup-error'),
  result: document.getElementById('lookup-result'),
  address: document.getElementById('lookup-address'),
  copy: document.getElementById('lookup-copy'),
  refresh: document.getElementById('lookup-refresh'),
  list: document.getElementById('lookup-email-list'),
  count: document.getElementById('lookup-count'),
  detail: document.getElementById('lookup-detail'),
  detailSubject: document.getElementById('lookup-detail-subject'),
  detailMeta: document.getElementById('lookup-detail-meta'),
  detailBody: document.getElementById('lookup-detail-body'),
  detailClose: document.getElementById('lookup-detail-close')
};

let currentCode = '';
let currentAddress = '';
let isLookingUp = false;

function normalizeCode(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

function showError(message) {
  if (els.error) els.error.textContent = message || '';
}

function hideDetail() {
  if (els.detail) els.detail.hidden = true;
}

function renderEmails(emails) {
  if (!els.list) return;
  if (els.count) els.count.textContent = emails.length ? `共 ${emails.length} 封` : '';
  if (!emails.length) {
    els.list.innerHTML = '<div class="lookup-empty">暂无邮件</div>';
    return;
  }
  els.list.innerHTML = emails.map((email) => `
    <button type="button" class="lookup-email-item" data-id="${email.id}">
      <span class="lookup-email-top">
        <span class="lookup-email-sender">${escapeHtml(email.sender || '未知发件人')}</span>
        <span class="lookup-email-time">${escapeHtml(formatTime(email.received_at))}</span>
      </span>
      <span class="lookup-email-subject">${escapeHtml(email.subject || '(无主题)')}</span>
      ${email.verification_code ? `<span class="lookup-email-code">验证码 ${escapeHtml(email.verification_code)}</span>` : ''}
    </button>
  `).join('');
}

async function lookup(code) {
  if (isLookingUp) return;
  isLookingUp = true;
  showError('');
  hideDetail();
  if (els.result) els.result.hidden = true;
  if (els.btn) els.btn.disabled = true;
  try {
    const res = await fetch('/api/public/lookup?code=' + encodeURIComponent(code));
    if (res.status === 400) { showError('访问码格式不对，请输入 8 位数字或字母'); return; }
    if (res.status === 404) { showError('访问码不存在，或邮箱已过期'); return; }
    if (res.status === 429) { showError('查询太频繁，请稍后再试'); return; }
    if (!res.ok) { showError('查询失败，请稍后再试'); return; }
    const data = await res.json();
    currentCode = code;
    currentAddress = data.address || '';
    if (els.address) els.address.textContent = currentAddress;
    if (els.result) els.result.hidden = false;
    renderEmails(data.emails || []);
    els.input?.blur();
  } catch (_) {
    showError('网络错误，请稍后再试');
  } finally {
    isLookingUp = false;
    if (els.btn) els.btn.disabled = false;
  }
}

async function openEmail(id) {
  if (!currentCode) return;
  try {
    const res = await fetch('/api/public/email/' + encodeURIComponent(id) + '?code=' + encodeURIComponent(currentCode));
    if (!res.ok) return;
    const email = await res.json();
    if (els.detailSubject) els.detailSubject.textContent = email.subject || '(无主题)';
    if (els.detailMeta) els.detailMeta.textContent = `${email.sender || '未知发件人'} · ${formatTime(email.received_at)}`;
    if (els.detailBody) {
      if (email.html_content) {
        els.detailBody.classList.remove('is-text');
        els.detailBody.innerHTML = sanitizeHtml(email.html_content, { allowStyles: false });
      } else {
        els.detailBody.classList.add('is-text');
        els.detailBody.textContent = email.content || '';
      }
    }
    if (els.detail) els.detail.hidden = false;
    els.detail?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {}
}

async function copyAddress() {
  if (!currentAddress) return;
  const ok = await copyText(currentAddress);
  if (ok) {
    if (els.copy) {
      els.copy.textContent = '已复制';
      setTimeout(() => { els.copy.textContent = '复制地址'; }, 1200);
    }
  } else {
    showError('复制失败，请手动选择复制');
  }
}

function getCode() {
  return normalizeCode(els.input?.value);
}

function renderBoxes() {
  const code = getCode();
  const focused = document.activeElement === els.input;
  els.boxes.forEach((box, index) => {
    const char = code[index] || '';
    box.textContent = char;
    box.classList.toggle('filled', Boolean(char));
    box.classList.toggle('active', focused && index === Math.min(code.length, els.boxes.length - 1));
  });
}

function submitCode() {
  const code = getCode();
  if (code.length !== 8) {
    showError('请输入完整的 8 位访问码');
    return;
  }
  lookup(code);
}

function focusInputAtEnd() {
  if (!els.input) return;
  els.input.focus();
  const length = els.input.value.length;
  try { els.input.setSelectionRange(length, length); } catch (_) {}
}

els.form?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitCode();
});

els.input?.addEventListener('input', () => {
  const code = normalizeCode(els.input.value);
  if (els.input.value !== code) els.input.value = code;
  showError('');
  renderBoxes();
  if (code.length === 8) submitCode();
});

els.input?.addEventListener('beforeinput', (event) => {
  if (event.inputType !== 'insertText' || !event.data) return;
  if (!/^[a-zA-Z0-9]+$/.test(event.data)) {
    event.preventDefault();
    showError('访问码只支持数字和字母');
  }
});

els.input?.addEventListener('focus', renderBoxes);
els.input?.addEventListener('blur', renderBoxes);
els.input?.addEventListener('click', focusInputAtEnd);
els.input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitCode();
  }
});

document.getElementById('access-code-boxes')?.addEventListener('click', focusInputAtEnd);

renderBoxes();

els.list?.addEventListener('click', (event) => {
  const item = event.target.closest('.lookup-email-item');
  if (item?.dataset?.id) openEmail(item.dataset.id);
});

els.copy?.addEventListener('click', copyAddress);
els.refresh?.addEventListener('click', () => { if (currentCode) lookup(currentCode); });
els.detailClose?.addEventListener('click', hideDetail);
