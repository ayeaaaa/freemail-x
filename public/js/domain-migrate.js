const showToast = window.showToast || ((msg) => console.log(msg));

const els = {
  domain: document.getElementById('domain-input'),
  token: document.getElementById('token-input'),
  ipv4: document.getElementById('ipv4-input'),
  ipv6: document.getElementById('ipv6-input'),
  ttl: document.getElementById('ttl-input'),
  submit: document.getElementById('submit-btn'),
  verify: document.getElementById('verify-btn'),
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
  const domainText = String(els.domain?.value || '').trim();
  const token = String(els.token?.value || '').trim();
  const ipv4 = String(els.ipv4?.value || '').trim();
  const ipv6 = String(els.ipv6?.value || '').trim();
  const ttl = Number(els.ttl?.value || 120);

  if (!domainText) {
    showToast('请输入域名列表', 'warn');
    return;
  }
  if (!token) {
    showToast('请输入 Cloudflare API Token', 'warn');
    return;
  }

  els.submit.disabled = true;
  setResult('正在批量迁移，请稍候...');

  try {
    const response = await api('/api/domain-migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainText, token, ipv4, ipv6, ttl })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || '迁移失败');
    }

    const lines = [];
    lines.push(`总数: ${payload.total || 0}`);
    lines.push(`成功: ${payload.successCount || 0}`);
    lines.push(`失败: ${payload.failedCount || 0}`);
    lines.push('');
    for (const item of payload.results || []) {
      if (item.success) {
        const result = item.result || {};
        lines.push(`[OK] ${item.domain}`);
        lines.push(`  zoneStatus: ${result.zoneStatus}`);
        lines.push(`  mailHost: ${result.mailHost}`);
        lines.push(`  rootMxMigrated: ${result.rootMxMigrated}`);
        lines.push(`  wildcardMxMigrated: ${result.wildcardMxMigrated}`);
      } else {
        lines.push(`[FAIL] ${item.domain}`);
        lines.push(`  error: ${item.error}`);
      }
      lines.push('');
    }
    setResult(lines.join('\n'));
    showToast('批量迁移完成', 'success');
  } catch (error) {
    setResult(`迁移失败: ${error.message}`);
    showToast(error.message || '迁移失败', 'error');
  } finally {
    els.submit.disabled = false;
  }
}

async function verifyToken() {
  const token = String(els.token?.value || '').trim();
  if (!token) {
    showToast('请输入 Cloudflare API Token', 'warn');
    return;
  }

  els.verify.disabled = true;
  setResult('正在检测 Token，请稍候...');

  try {
    const response = await api('/api/domain-migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['example.com'], token, ipv4: '0.0.0.0', ipv6: '::', ttl: 120, dryRun: true })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || '检测失败');
    }

    const tokenInfo = payload.results?.[0]?.result?.tokenInfo;
    setResult(JSON.stringify({
      tokenKind: tokenInfo?.tokenKind,
      accountId: tokenInfo?.accountId,
      zoneCountHint: tokenInfo?.zoneCountHint,
      note: 'Token 可访问 Cloudflare API（仅检测，不执行迁移）'
    }, null, 2));
    showToast('Token 检测完成', 'success');
  } catch (error) {
    setResult(`Token 检测失败: ${error.message}`);
    showToast(error.message || '检测失败', 'error');
  } finally {
    els.verify.disabled = false;
  }
}

els.submit?.addEventListener('click', submit);
els.verify?.addEventListener('click', verifyToken);
els.clear?.addEventListener('click', () => setResult(''));
