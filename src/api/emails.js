/**
 * 邮件 API 模块
 * @module api/emails
 */

import { getJwtPayload, errorResponse } from './helpers.js';
import { buildMockEmails, buildMockEmailDetail } from './mock.js';
import { extractEmail } from '../utils/common.js';
import { getMailboxIdByAddress } from '../db/index.js';
import { parseEmailBody } from '../email/parser.js';

/**
 * 处理邮件相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleEmailsApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;
  const isMailboxOnly = !!options.mailboxOnly;
  const r2 = null;

  // 获取邮件列表
  if (path === '/api/emails' && request.method === 'GET') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return errorResponse('缺少 mailbox 参数', 400);
    }
    try {
      if (isMock) {
        return Response.json(buildMockEmails(6));
      }
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) return Response.json([]);
      
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }
      
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, received_at, is_read, preview, verification_code
          FROM messages 
          WHERE mailbox_id = ?${timeFilter}
          ORDER BY received_at DESC 
          LIMIT ?
        `).bind(mailboxId, ...timeParam, limit).all();
        return Response.json(results);
      } catch (e) {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, received_at, is_read,
                 CASE WHEN content IS NOT NULL AND content <> ''
                      THEN SUBSTR(content, 1, 120)
                      ELSE SUBSTR(COALESCE(html_content, ''), 1, 120)
                 END AS preview
          FROM messages 
          WHERE mailbox_id = ?${timeFilter}
          ORDER BY received_at DESC 
          LIMIT ?
        `).bind(mailboxId, ...timeParam, limit).all();
        return Response.json(results);
      }
    } catch (e) {
      console.error('查询邮件失败:', e);
      return errorResponse('查询邮件失败', 500);
    }
  }

  // 批量查询邮件详情
  if (path === '/api/emails/batch' && request.method === 'GET') {
    try {
      const idsParam = String(url.searchParams.get('ids') || '').trim();
      if (!idsParam) return Response.json([]);
      const ids = idsParam.split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n > 0);
      if (!ids.length) return Response.json([]);
      
      if (ids.length > 50) {
        return errorResponse('单次最多查询50封邮件', 400);
      }
      
      if (isMock) {
        const arr = ids.map(id => buildMockEmailDetail(id));
        return Response.json(arr);
      }
      
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }
      
      const placeholders = ids.map(() => '?').join(',');
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${timeFilter}
        `).bind(...ids, ...timeParam).all();
        return Response.json(results || []);
      } catch (e) {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, content, html_content, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${timeFilter}
        `).bind(...ids, ...timeParam).all();
        return Response.json(results || []);
      }
    } catch (e) {
      return errorResponse('批量查询失败', 500);
    }
  }

  // 清空邮箱邮件
  if (request.method === 'DELETE' && path === '/api/emails') {
    if (isMock) return errorResponse('演示模式不可清空', 403);
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return errorResponse('缺少 mailbox 参数', 400);
    }
    try {
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) {
        return Response.json({ success: true, deletedCount: 0 });
      }
      
      // 先查出所有 r2_object_key，再删除 DB 记录，最后清理 R2
      const { results: toDelete } = await db.prepare(
        `SELECT r2_object_key FROM messages WHERE mailbox_id = ? AND r2_object_key IS NOT NULL`
      ).bind(mailboxId).all();

      const result = await db.prepare(`DELETE FROM messages WHERE mailbox_id = ?`).bind(mailboxId).run();
      const deletedCount = result?.meta?.changes || 0;

      if (r2 && toDelete?.length) {
        for (const { r2_object_key } of toDelete) {
          try { await r2.delete(r2_object_key); } catch (r2Err) {
            console.error('清空邮件时删除 R2 对象失败:', r2Err);
          }
        }
      }

      return Response.json({
        success: true,
        deletedCount
      });
    } catch (e) {
      console.error('清空邮件失败:', e);
      return errorResponse('清空邮件失败', 500);
    }
  }

  // 下载 EML（无 R2 模式下不可用）
  if (request.method === 'GET' && path.startsWith('/api/email/') && path.endsWith('/download')) {
    return errorResponse('未保留原始 EML', 410);
  }

  // 获取单封邮件详情
  if (request.method === 'GET' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    if (isMock) {
      return Response.json(buildMockEmailDetail(emailId));
    }
    try {
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }
      
      const { results } = await db.prepare(`
        SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read
        FROM messages WHERE id = ?${timeFilter}
      `).bind(emailId, ...timeParam).all();
      if (results.length === 0) {
        if (isMailboxOnly) {
          return errorResponse('邮件不存在或已超过24小时访问期限', 404);
        }
        return errorResponse('未找到邮件', 404);
      }
      await db.prepare(`UPDATE messages SET is_read = 1 WHERE id = ?`).bind(emailId).run();
      const row = results[0];
      let content = '';
      let html_content = '';
      try {
        const fallback = await db.prepare('SELECT content, html_content FROM messages WHERE id = ?').bind(emailId).all();
        const fr = (fallback?.results || [])[0] || {};
        content = fr.content || '';
        html_content = fr.html_content || '';
      } catch (_) { }

      return Response.json({ ...row, content, html_content, download: '' });
    } catch (e) {
      const { results } = await db.prepare(`
        SELECT id, sender, to_addrs, subject, content, html_content, received_at, is_read
        FROM messages WHERE id = ?
      `).bind(emailId).all();
      if (!results || !results.length) return errorResponse('未找到邮件', 404);
      await db.prepare(`UPDATE messages SET is_read = 1 WHERE id = ?`).bind(emailId).run();
      return Response.json(results[0]);
    }
  }

  // 删除单封邮件
  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    if (isMock) return errorResponse('演示模式不可删除', 403);
    const emailId = path.split('/')[3];

    if (!emailId || !Number.isInteger(parseInt(emailId))) {
      return errorResponse('无效的邮件ID', 400);
    }

    try {
      const result = await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(emailId).run();
      const deleted = (result?.meta?.changes || 0) > 0;

      return Response.json({
        success: true,
        deleted,
        message: deleted ? '邮件已删除' : '邮件不存在或已被删除'
      });
    } catch (e) {
      console.error('删除邮件失败:', e);
      return errorResponse('删除邮件时发生错误: ' + e.message, 500);
    }
  }

  return null;
}
