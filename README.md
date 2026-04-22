# Freemail Mail Chain + VPS Admin

这是一个基于原 `freemail` 改造的版本，目标是将系统拆成两部分：

- Cloudflare Worker 只保留邮件链路
- VPS 提供单管理员极简后台与 PostgreSQL 存储

## 当前架构

```text
外部邮件
-> Cloudflare Email Routing
-> freemail-mail-chain / freemail-wen-api（当前实际收件入口按你的 Catch-all 决定）
-> VPS /inbound-email
-> PostgreSQL

VPS 管理面板
-> VPS /api/*
-> PostgreSQL
```

## 当前版本特征

- 无 D1 主数据路径
- 无 R2 依赖（不保留原始 EML）
- 只保留正文和元数据
- 单管理员模式
- 不包含多用户管理、发件、收藏、转发等非核心能力

## 组件说明

### 1. Cloudflare Worker

Worker 只负责：

- 接收邮件
- 解析邮件正文、HTML、验证码、预览
- 将邮件元数据直接投递到 VPS

不再负责：

- 后台页面
- 邮箱管理 API
- 数据库存储
- 原始 EML 保留

### 2. VPS 后台

VPS 负责：

- 单管理员登录
- 邮箱列表 / 创建 / 生成 / 删除
- 邮件列表 / 详情 / 删除
- PostgreSQL 存储
- 静态面板托管

## 公开仓库中的配置说明

仓库里的配置文件已经脱敏，你需要自行替换为真实值。

### `wrangler.toml`

关键变量：

```toml
ADMIN_NAME="admin"
ADMIN_PASSWORD="your-admin-password"
JWT_TOKEN="your-jwt-token"
MAIL_DOMAIN="example.com,alt.example.com"
DB_API_URL="http://your-vps-host:18080"
DB_API_TOKEN="your-api-token"
```

说明：

- `DB_API_URL` 指向你的 VPS 后端
- `DB_API_TOKEN` 用于 Worker -> VPS 的安全投递
- `MAIL_DOMAIN` 是可用根域列表

## VPS 后台 API

当前这套单管理员极简版主要保留这些接口：

### 认证

- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`

### 域名 / 邮箱

- `GET /api/domains`
- `GET /api/mailboxes`
- `GET /api/mailbox/info`
- `POST /api/create`
- `GET /api/generate`
- `GET /api/user/quota`
- `POST /api/mailboxes/pin`
- `POST /api/mailboxes/toggle-login`
- `POST /api/mailboxes/change-password`
- `POST /api/mailboxes/reset-password`
- `POST /api/mailboxes/batch-toggle-login`
- `DELETE /api/mailboxes`

### 邮件

- `GET /api/emails`
- `GET /api/emails/batch`
- `GET /api/email/:id`
- `GET /api/email/:id/download`
- `DELETE /api/email/:id`
- `DELETE /api/emails`

说明：

- 无 R2 模式下，`/api/email/:id/download` 返回 `410 raw_email_not_retained`
- 邮件详情正文直接来自 PostgreSQL 中的 `content` / `html_content`

## 管理面板

原 `freemail` 面板已经迁到 VPS，可作为单管理员极简后台使用。

示例地址：

- `http://your-vps-host:18080/`
- `http://your-vps-host:18080/html/login.html`

## PostgreSQL 要求

数据库需至少包含：

- `mailboxes`
- `messages`
- `users`
- `user_mailboxes`
- `sent_emails`

在无 R2 版本中，`messages` 表建议包含：

- `content`
- `html_content`

并允许：

- `r2_bucket` 为 `NULL`
- `r2_object_key` 为 `NULL`

## 注意事项

- 如果真实 Catch-all 还指向旧 Worker，那么新代码不会生效
- 要确认哪个 Worker 在实际收件，建议用 `wrangler tail` + 实际发信联合确认
- 公开仓库中的配置均为示例值，请不要直接用于生产

## 适用场景

适合：

- 临时邮箱系统本地化
- 只保留 Cloudflare 邮件入口
- 后台和数据完全迁到 VPS
- 单管理员模式

不适合：

- 需要完整原始 EML 存档
- 需要发件
- 需要复杂多用户权限体系
