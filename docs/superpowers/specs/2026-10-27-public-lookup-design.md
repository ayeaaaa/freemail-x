# 公开访问码查询页 — 设计文档

日期：2026-10-27
状态：已与用户确认设计方向，待写实施计划

## 背景与问题

当前 `/` 是管理端邮箱应用（`public/index.html`），未登录会被重定向到登录页。用户希望新增一个**公开默认页**：任何人输入 8 位访问码即可查看对应邮箱及其邮件内容，只读；匿名用户默认只能使用这一功能。管理端功能保持登录后才能访问。

访问码是**独立于邮箱地址**的 8 位 `[a-z0-9]` 码（不是邮箱用户名），仅对**新创建**的邮箱生成；数据库里已有的 1911 个老邮箱不补发（保持 NULL，不可通过公开页查询）。

## 目标

- `/` 默认返回公开查询页（所有人，包括已登录管理员）
- 输入 8 位访问码 → 展示完整邮箱地址 + 邮件列表 + 单封正文（只读）
- 管理端入口保留：公开页右上角「管理登录」→ 登录后进入 `/index.html`
- 匿名用户仅能访问公开页与公开查询 API；其余页面/API 仍需登录
- 新邮箱创建时生成唯一访问码，并在管理端展示（创建时 + 邮箱列表可查）

## 非目标

- 不给老邮箱补发访问码
- 不做访问码的修改、吊销、过期
- 不改变现有管理端功能、权限与邮件收发逻辑
- 公开页不提供发送、删除、收藏、转发等任何写操作

## 数据模型

```sql
ALTER TABLE mailboxes ADD COLUMN access_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_access_code_key
  ON mailboxes(access_code) WHERE access_code IS NOT NULL;
```

- 生成规则：`generateRandomId(8)`（现有函数，字符集 `[a-z0-9]`），唯一冲突时重试，最多 5 次
- 新建邮箱都会生成访问码，包括：手动生成/自定义创建、用户分配时创建、收信时自动创建
- 老邮箱 `access_code IS NULL`；部分唯一索引允许 NULL
- 不执行 backfill

## 后端（`.remote-freemail-server.mjs`）

### 邮箱创建与返回

- `getOrCreateMailbox(client, address)` 改为返回 `{ id, accessCode }`：
  - 新建：生成唯一 `access_code` 写入 `INSERT`；冲突（`mailboxes_access_code_key`）时重新生成
  - 已存在：返回现有行的 `access_code`（老邮箱可能为 `null`）
- 调用点适配（4 处）：`/api/create`、`/api/generate`、`/api/users/assign`、`/inbound-email`
- 响应新增 `access_code` 字段：
  - `POST /api/create`、`/api/generate`：`{ email, expires, success, mailbox_id, access_code }`
  - `GET /api/mailboxes`：列表 SELECT 增加 `access_code`
  - `GET /api/mailbox/info`：返回增加 `access_code`

### 公开接口（无需登录，只读）

统一校验：`code = String(param).trim().toLowerCase()`，必须匹配 `^[a-z0-9]{8}$`，否则 `400 { error: 'invalid_code' }`。

1. `GET /api/public/lookup?code=XXXXXXXX`
   - 按 `access_code` 查邮箱；不存在 → `404 { error: 'not_found' }`
   - 返回：
     ```json
     {
       "address": "abc12345@example.com",
       "created_at": "2026-10-27 ...",
       "emails": [
         { "id": 1, "sender": "...", "subject": "...", "received_at": "...", "preview": "...", "verification_code": "123456" }
       ]
     }
     ```
   - `emails` 按 `id DESC`，最多 50 封
2. `GET /api/public/email/<id>?code=XXXXXXXX`
   - 按码查邮箱；再按 `id + mailbox_id` 查邮件；任一不存在 → `404 { error: 'not_found' }`
   - 返回：`{ id, sender, to_addrs, subject, received_at, content, html_content, verification_code }`

### 限流

- 内存 Map，按 `req.socket.remoteAddress` 统计；窗口 60 秒，最多 30 次（两个公开接口合计）
- 超限 → `429 { error: 'rate_limited' }`
- 定期清理过期 IP 记录，避免内存增长

### 路由

- `serveStaticFile` 中 `/` 映射由 `/index.html` 改为 `/lookup.html`
- 原管理应用仍通过 `/index.html` 访问

## 前端

### 公开页（新增）

- `public/lookup.html`
  - 引入 `tokens.css`、`components.css`、`theme-switcher.css`、`lookup.css`、`theme.js`
  - `<meta name="robots" content="noindex">`
  - 顶部：品牌（iDing's 临时邮箱）+ 右侧「管理登录」（`/html/login.html`）
  - 主卡片：标题、8 位输入框（`maxlength=8`，自动转小写/过滤非法字符）、查询按钮
  - 结果区（初始隐藏）：
    - 邮箱地址（等宽字体）+ 复制按钮 + 刷新按钮
    - 邮件列表：发件人、主题、时间、验证码徽标；空状态「暂无邮件」
    - 点击邮件 → 详情面板：主题/发件人/时间 + 正文（`html_content` 消毒后渲染；无 HTML 时显示纯文本）
    - 错误态：格式错误、访问码不存在、限流、网络错误
  - 移动端适配
- `public/js/lookup.js`
  - 提交时校验 `^[a-z0-9]{8}$` → `GET /api/public/lookup`
  - 点击邮件 → `GET /api/public/email/<id>?code=...`
  - 复用 `public/js/core/sanitize.js`（见下）
- `public/css/lookup.css`

### 共享 HTML 消毒

- 将 `sanitizeHtml` 从 `public/js/modules/mailbox/email-detail.js` 原样移到 `public/js/core/sanitize.js` 并导出
- `email-detail.js` 改为 `import { sanitizeHtml } from '../../core/sanitize.js'`
- `lookup.js` 同样导入，避免重复实现

### 管理端展示访问码

- `public/html/app.html`：当前邮箱区域新增访问码行（默认隐藏）：
  `访问码：<code id="access-code-text"></code>` + 复制按钮
- `public/js/modules/app/mailbox-actions.js`：
  - 生成/创建成功后用响应的 `access_code` 更新该行
  - 选中已有邮箱时用 `/api/mailbox/info` 返回的 `access_code` 更新
- `public/js/modules/app/mailbox-list.js`：列表项显示小号等宽访问码（有码才显示），点击复制
- `public/js/app.js`：新增 `window.copyAccessCode` 全局函数（复用复制 + toast）

### 跳转修正（`/` 不再是应用）

- `public/index.html`：3 处 `redirect=/` → `redirect=/index.html`
- `public/js/login.js`：默认 target `/` → `/index.html`；`target === '/'` 的管理员/访客分支 → `/index.html`
- `public/js/auth-guard.js`：2 处兜底 `/` → `/index.html`
- `public/templates/loading.html`：兜底 `/` → `/index.html`

## 安全

- 公开接口只读，且只能按访问码查单个邮箱；不返回邮箱列表、用户、管理数据
- 访问码 8 位 `[a-z0-9]`（36^8 ≈ 2.8 万亿）+ 每 IP 30 次/分钟限流
- 公开页渲染 HTML 前必须消毒（复用现有 `sanitizeHtml`）
- 老邮箱无访问码，公开接口不会命中
- 公开页加 `noindex`

## 修改文件

- `.remote-freemail-server.mjs`：access_code 生成/返回、公开接口、限流、`/` 路由
- `public/lookup.html`、`public/css/lookup.css`、`public/js/lookup.js`（新增）
- `public/js/core/sanitize.js`（新增，函数搬移）
- `public/js/modules/mailbox/email-detail.js`（改为导入 sanitize）
- `public/html/app.html`、`public/js/modules/app/mailbox-actions.js`、`public/js/modules/app/mailbox-list.js`、`public/js/app.js`
- `public/index.html`、`public/js/login.js`、`public/js/auth-guard.js`、`public/templates/loading.html`
- `tests/public-lookup.test.mjs`（新增）

## 测试与验证

1. 静态测试 `tests/public-lookup.test.mjs`：
   - 服务端存在 `/api/public/lookup`、`/api/public/email/`、`access_code` 写入与查询、`/` → `/lookup.html`
   - `lookup.html` 含 8 位输入框与 `/api/public/lookup` 调用
   - 跳转修正后不再有 `redirect=/`（应用路径为 `/index.html`）
2. 全量测试：`for t in tests/*.test.mjs; ...` 全 PASS
3. 线上数据库迁移：加列 + 部分唯一索引
4. 部署后端 + 前端静态文件，md5 一致
5. 线上 E2E：
   - 登录管理端创建新邮箱 → 响应含 8 位 `access_code`，UI 显示访问码
   - 无 Cookie 调 `/api/public/lookup?code=...` → 返回地址与邮件列表
   - SMTP 发一封测试邮件 → 公开查询能看到该邮件与正文
   - 错误码：非法格式 400、不存在 404、超限 429
   - 匿名访问 `/api/mailboxes` 仍 401；匿名访问 `/` 返回公开页
   - 管理员登录后 `/index.html` 正常，`/` 仍是公开页
6. 清理测试邮箱与测试数据

## 兼容性

- 老邮箱无 `access_code`，管理端列表/详情显示为空，公开页查不到（符合“只对新邮箱生效”）
- `getOrCreateMailbox` 返回结构变化仅影响服务端 4 个调用点，已全部适配
- 现有管理端 API 响应只新增字段，向后兼容
- 原应用地址由 `/` 变为 `/index.html`；登录与加载页跳转同步更新
