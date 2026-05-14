const showToast = window.showToast || ((msg) => console.log(msg));

const els = {
  domain: document.getElementById('domain-input'),
  token: document.getElementById('token-input'),
  ipv4: document.getElementById('ipv4-input'),
  ipv6: document.getElementById('ipv6-input'),
  ttl: document.getElementById('ttl-input'),
  submit: document.getElementById('submit-btn'),
  clear: document.getElementById('clear-btn'),
  result: document.getElementById('result-box')
};

function setResult(value) {
  if (els.result) els.result.textContent = value;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Cache-Control': 'no-cache',
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    location.replace('/html/login.html');
    throw new Error('unauthorized');
  }
  return response;
}

async function submit() {
  const domain = String(els.domain?.value || '').trim().toLowerCase();
  const token = String(els.token?.value || '').trim();
  const ipv4 = String(els.ipv4?.value || '').trim();
  const ipv6 = String(els.ipv6?.value || '').trim();
  const ttl = Number(els.ttl?.value || 120);

  if (!domain) {
    showToast('请输入域名', 'warn');
    return;
  }
  if (!token) {
    showToast('请输入 Cloudflare API Token', 'warn');
    return;
  }

  els.submit.disabled = true;
  setResult('正在迁移，请稍候...');

  try {
    const response = await api('/api/domain-migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, token, ipv4, ipv6, ttl })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || '迁移失败');
    }

    setResult(JSON.stringify(payload, null, 2));
    showToast('迁移完成', 'success');
  } catch (error) {
    setResult(`迁移失败: ${error.message}`);
    showToast(error.message || '迁移失败', 'error');
  } finally {
    els.submit.disabled = false;
  }
}

els.submit?.addEventListener('click', submit);
els.clear?.addEventListener('click', () => setResult(''));
