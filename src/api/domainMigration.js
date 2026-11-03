/**
 * 域名迁移 API
 * @module api/domainMigration
 */

import { errorResponse, isStrictAdmin } from './helpers.js';
import { migrateDomainToVps } from '../deploy/cloudflareDomainMigration.js';

function parseDomainList(body = {}) {
  if (Array.isArray(body.domains)) {
    return body.domains
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }

  const text = String(body.domainText || body.domain || '').trim();
  if (!text) return [];

  return text
    .split(/\r?\n|,|\s+/)
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

export async function handleDomainMigrationApi(request, url, path, options = {}) {
  if (path !== '/api/domain-migrate' || request.method !== 'POST') return null;
  if (!isStrictAdmin(request, options)) {
    return errorResponse('仅超级管理员可执行域名迁移', 403);
  }

  try {
    const body = await request.json();
    const domains = parseDomainList(body);
    if (!domains.length) {
      return Response.json({ success: false, error: '缺少域名' }, { status: 400 });
    }

    if (body.dryRun) {
      const token = String(body.token || '').trim();
      if (!token) {
        return Response.json({ success: false, error: '缺少 Cloudflare API Token' }, { status: 400 });
      }
      const previewDomain = domains[0];
      const result = await migrateDomainToVps({
        domain: previewDomain,
        token,
        ipv4: body.ipv4,
        ipv6: body.ipv6,
        ttl: body.ttl,
        dryRun: true
      });
      return Response.json({
        success: true,
        dryRun: true,
        results: [{ domain: previewDomain, success: true, result }]
      });
    }

    const results = [];
    for (const domain of domains) {
      try {
        const result = await migrateDomainToVps({
          domain,
          token: body.token,
          ipv4: body.ipv4,
          ipv6: body.ipv6,
          ttl: body.ttl
        });
        results.push({ domain, success: true, result });
      } catch (error) {
        results.push({ domain, success: false, error: String(error?.message || '迁移失败') });
      }
    }

    const successCount = results.filter((item) => item.success).length;
    return Response.json({
      success: successCount > 0,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: String(error?.message || '迁移失败')
    }, { status: 400 });
  }
}
