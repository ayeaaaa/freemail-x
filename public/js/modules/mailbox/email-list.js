/**
 * 邮件列表模块
 * @module modules/mailbox/email-list
 */

import { escapeHtml, escapeAttr } from '../app/ui-helpers.js';
import { parseServerTime } from '../../core/utils.js';

/**
 * 格式化时间戳
 * @param {string} ts - 时间戳
 * @returns {string}
 */
export function formatTime(ts) {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(d);
  } catch (_) {
    return String(ts);
  }
}

/**
 * 截取预览文本
 * @param {string} text - 完整文本
 * @param {number} maxLength - 最大长度
 * @returns {string}
 */
export function truncateText(text, maxLength = 100) {
  if (!text) return '';
  const s = String(text).trim();
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength) + '...';
}

/**
 * 渲染邮件列表项
 * @param {object} email - 邮件数据
 * @returns {string}
 */
export function renderEmailItem(email) {
  const id = email.id;
  const sender = escapeHtml(email.sender || '未知发件人');
  const subject = escapeHtml(email.subject || '(无主题)');
  const preview = escapeHtml(truncateText(email.preview || email.content || '', 80));
  const receivedAt = formatTime(email.received_at);
  const isRead = email.is_read ? 'read' : 'unread';
  const verificationCode = email.verification_code || '';
  
  return `
    <div class="email-item ${isRead}" data-email-id="${id}">
      <div class="email-header">
        <span class="email-sender" title="${escapeAttr(email.sender || '')}">${sender}</span>
        <span class="email-time">${receivedAt}</span>
      </div>
      <div class="email-subject">${subject}</div>
      <div class="email-preview">${preview}</div>
      ${verificationCode ? `<div class="email-code" title="点击复制验证码">🔑 ${escapeHtml(verificationCode)}</div>` : ''}
    </div>
  `;
}

/**
 * 渲染邮件列表
 * @param {Array} emails - 邮件数组
 * @param {HTMLElement} container - 容器元素
 */
export function renderEmailList(emails, container) {
  if (!container) return;
  
  if (!emails || emails.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = emails.map(e => renderEmailItem(e)).join('');
}

/**
 * 生成骨架屏邮件项
 * @returns {string}
 */
export function createSkeletonEmailItem() {
  return `
    <div class="email-item skeleton">
      <div class="email-header">
        <div class="skeleton-line sender-line"></div>
        <div class="skeleton-line time-line"></div>
      </div>
      <div class="skeleton-line subject-line"></div>
      <div class="skeleton-line preview-line"></div>
    </div>
  `;
}

/**
 * 生成骨架屏列表
 * @param {number} count - 数量
 * @returns {string}
 */
export function generateSkeletonList(count = 5) {
  return Array(count).fill(null).map(() => createSkeletonEmailItem()).join('');
}

/**
 * 搜索过滤邮件
 * @param {Array} emails - 邮件数组
 * @param {string} keyword - 搜索关键词
 * @returns {Array}
 */
export function filterEmails(emails, keyword) {
  if (!keyword || !keyword.trim()) return emails;
  
  const term = keyword.toLowerCase().trim();
  return emails.filter(e => {
    const sender = (e.sender || '').toLowerCase();
    const subject = (e.subject || '').toLowerCase();
    const preview = (e.preview || e.content || '').toLowerCase();
    return sender.includes(term) || subject.includes(term) || preview.includes(term);
  });
}

/**
 * 排序邮件
 * @param {Array} emails - 邮件数组
 * @param {string} sortBy - 排序字段
 * @param {string} order - 排序顺序
 * @returns {Array}
 */
export function sortEmails(emails, sortBy = 'received_at', order = 'desc') {
  const result = [...emails];
  
  result.sort((a, b) => {
    let valueA, valueB;
    
    switch (sortBy) {
      case 'sender':
        valueA = (a.sender || '').toLowerCase();
        valueB = (b.sender || '').toLowerCase();
        break;
      case 'subject':
        valueA = (a.subject || '').toLowerCase();
        valueB = (b.subject || '').toLowerCase();
        break;
      case 'received_at':
      default:
        valueA = parseServerTime(a.received_at)?.getTime() ?? 0;
        valueB = parseServerTime(b.received_at)?.getTime() ?? 0;
        break;
    }
    
    if (order === 'asc') {
      return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
    } else {
      return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
    }
  });
  
  return result;
}

/**
 * 计算未读数量
 * @param {Array} emails - 邮件数组
 * @returns {number}
 */
export function countUnread(emails) {
  if (!emails) return 0;
  return emails.filter(e => !e.is_read).length;
}

// 导出默认对象
export default {
  formatTime,
  truncateText,
  renderEmailItem,
  renderEmailList,
  createSkeletonEmailItem,
  generateSkeletonList,
  filterEmails,
  sortEmails,
  countUnread
};
