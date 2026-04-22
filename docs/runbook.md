# 运行手册

本文档用于说明当前仓库的实际运行方式，以及常见部署/切换动作。

## 组件分工

### 1. `freemail-mail-chain`

Cloudflare Worker，仅负责邮件链路：

- 接收邮件
- 解析正文 / HTML / 验证码 / 预览
- 将邮件元数据发送到 VPS `/inbound-email`

不负责：

- 后台页面
- 邮箱管理 API
- 原始 EML 存储

### 2. VPS `freemail-db-api`

负责：

- 单管理员面板
- `/api/*` 后台接口
- PostgreSQL 数据存储

## 当前推荐结构

```text
Cloudflare Email Routing
-> freemail-mail-chain
-> VPS /inbound-email
-> PostgreSQL

浏览器 / 本地程序
-> VPS /api/*
-> PostgreSQL
```

## Catch-all 切换

如果你希望真实收件走邮件链路专用 Worker，请将 Cloudflare Email Routing 的 Catch-all 指向：

- `freemail-mail-chain`

如果 Catch-all 仍然指向旧 Worker，例如：

- `freemail-wen-api`

那么实际收件不会走最新链路。

## 无 D1 / 无 R2 说明

当前推荐运行方式：

- 不使用 D1 作为主数据路径
- 不使用 R2 保留原始 EML
- 新邮件只保留正文和元数据

对应要求：

- PostgreSQL `messages.r2_bucket` 可为 `NULL`
- PostgreSQL `messages.r2_object_key` 可为 `NULL`
- `messages.content` / `messages.html_content` 可用于详情展示

## VPS 面板入口

示例：

- `http://your-vps-host:18080/`
- `http://your-vps-host:18080/html/login.html`

## 常见验证步骤

### 1. 验证 Worker 健康状态

```bash
curl https://your-worker.workers.dev/health
```

### 2. 验证 VPS 后台健康状态

```bash
curl http://your-vps-host:18080/health
```

### 3. 验证登录

```bash
curl -i -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-admin-password"}' \
  http://your-vps-host:18080/api/login
```

### 4. 验证创建邮箱

```bash
curl -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com"}' \
  http://your-vps-host:18080/api/create
```

### 5. 验证收件入库

发送一封真实邮件到新地址后，检查：

```bash
curl -H "Authorization: Bearer your-api-token" \
  "http://your-vps-host:18080/api/emails?mailbox=demo%40example.com&limit=5"
```

## 故障定位建议

### 邮件进不来

先确认：

- Catch-all 是否指向正确 Worker
- `wrangler tail <worker-name>` 是否能看到邮件日志
- VPS `/inbound-email` 是否收到请求

### 面板能打开但看不到邮件

确认：

- PostgreSQL 中是否已有 `messages` 记录
- VPS `/api/emails` 是否正常返回

### 原始下载失效

当前无 R2 模式下是预期行为：

- `/api/email/:id/download` 返回 `410 raw_email_not_retained`
