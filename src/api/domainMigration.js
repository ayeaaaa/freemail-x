/**
 * 域名迁移 API
 * @module api/domainMigration
 */

import { errorResponse, isStrictAdmin } from './helpers.js';
import { migrateDomainToVps } from '../deploy/cloudflareDomainMigration.js';

export async function handleDomainMigrationApi(request, url, path, options = {}) {
  if (path !== '/api/domain-migrate' || request.method !== 'POST') return null;
  if (!isStrictAdmin(request, options)) {
    return errorResponse('仅超级管理员可执行域名迁移', 403);
  }

  try {
    const body = await request.json();
    const result = await migrateDomainToVps({
      domain: body.domain,
      token: body.token,
      ipv4: body.ipv4,
      ipv6: body.ipv6,
      ttl: body.ttl
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({
      success: false,
      error: String(error?.message || '迁移失败')
    }, { status: 400 });
  }
}
