# Freemail VPS 直收手动部署说明

这份文档用于人工手动部署当前仓库的 VPS 后端和 SMTP 直收方案。

适用目标：

- 后台页面和 API 跑在 VPS
- 邮件直接进入 VPS 的 `25` 端口
- 不再依赖 Cloudflare Worker 做邮件中转

## 一、目标架构

```text
外部邮件
-> 域名 MX
-> mail.<your-domain>
-> VPS:25
-> tools/smtp-test/server.mjs
-> http://127.0.0.1:18080/inbound-email
-> PostgreSQL

后台页面
-> http://<your-vps>:18080/
```

## 二、前置条件

部署前请确认：

1. 你有一台可 SSH 登录的 Linux VPS
2. VPS 已安装 Node.js 和 npm
3. VPS 已安装 PostgreSQL，或已有可用 PostgreSQL 容器
4. VPS 的 `25/tcp` 已放通
5. 域名由你控制 DNS
6. 你知道后台管理员账号、JWT、数据库 API Token

建议额外确认：

1. `mail.<your-domain>` 的 A/AAAA 已准备好
2. 云平台安全组允许入站 `25/tcp`
3. 机器反向解析 PTR 已配置

## 三、部署 VPS 后端

### 1. 上传项目代码

把仓库代码上传到 VPS，例如：

```bash
mkdir -p /opt/freemail-db-api
```

然后把项目文件同步到：

- `/opt/freemail-db-api`

### 2. 安装依赖

如果后端有独立依赖，进入对应目录安装：

```bash
cd /opt/freemail-db-api
npm install
```

### 3. 配置后端服务

推荐使用 `systemd`。

示例服务文件：

`/etc/systemd/system/freemail-db-api.service`

```ini
[Unit]
Description=Freemail Thin DB API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/freemail-db-api
Environment=PORT=18080
Environment=ADMIN_NAME=admin
Environment=ADMIN_PASSWORD=your-admin-password
Environment=JWT_TOKEN=your-jwt-token
Environment=DB_API_TOKEN=your-db-api-token
Environment=MAIL_DOMAIN=example.com,alt.example.com
ExecStart=/usr/bin/node /opt/freemail-db-api/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
systemctl daemon-reload
systemctl enable --now freemail-db-api
systemctl status freemail-db-api
```

### 4. 验证后端

```bash
curl http://127.0.0.1:18080/api/session
```

未登录时返回未授权是正常的，关键是服务能响应。

## 四、部署 SMTP 直收服务

仓库中提供的 SMTP 入口位于：

- `tools/smtp-test/`

### 1. 上传 SMTP 目录

把这个目录上传到 VPS，例如：

- `/opt/freemail-smtp-ingress`

### 2. 安装依赖

```bash
cd /opt/freemail-smtp-ingress
npm install
```

### 3. 配置 systemd

创建：

- `/etc/systemd/system/freemail-smtp-ingress.service`

```ini
[Unit]
Description=Freemail SMTP Ingress
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/freemail-smtp-ingress
Environment=SMTP_PORT=25
Environment=DB_API_URL=http://127.0.0.1:18080
Environment=DB_API_TOKEN=your-db-api-token
ExecStart=/usr/bin/node /opt/freemail-smtp-ingress/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

启动：

```bash
systemctl daemon-reload
systemctl enable --now freemail-smtp-ingress
systemctl status freemail-smtp-ingress
```

### 4. 验证 25 端口监听

```bash
ss -lnt | grep :25
```

## 五、Cloudflare 或 DNS 配置

如果你要把域名切到 VPS 直收，建议按以下方式配置。

### 1. 添加 `mail` 主机

添加：

1. `mail.<your-domain> A -> <VPS IPv4>`
2. `mail.<your-domain> AAAA -> <VPS IPv6>`

必须使用：

- `DNS only`

不能开启代理。

### 2. 设置根域 MX

```text
<your-domain> MX 10 mail.<your-domain>
```

### 3. 设置泛子域 MX

如果需要泛子域收件，添加：

```text
*.<your-domain> MX 1 mail.<your-domain>
```

### 4. 如使用 Cloudflare Email Routing

如果根域当前启用了 Email Routing，需要先：

1. 解锁或关闭 Email Routing 对 MX 的托管
2. 再修改根域 MX

## 六、验证 SMTP 直收

### 1. 本机 SMTP 测试

在 VPS 上运行：

```bash
cd /opt/freemail-smtp-ingress
SMTP_TEST_RECIPIENT="test@example.com" npm run send:test
```

### 2. 查看 SMTP 服务日志

```bash
journalctl -u freemail-smtp-ingress -n 50 --no-pager
```

### 3. 查看数据库是否入库

按你的 PostgreSQL 连接方式查询 `messages` 表。

### 4. 真实外部测试

用 Gmail、Outlook 或其他邮箱发到：

1. `test@<your-domain>`
2. `test@foo.<your-domain>`

然后检查：

1. SMTP 日志
2. PostgreSQL
3. 前端页面是否可见

## 七、回滚方案

如果切换后收件异常，回滚方式如下：

1. 把域名 MX 改回旧收件入口
2. 保留 VPS 上的 SMTP 服务不动
3. 再逐项检查安全组、DNS、数据库链路

## 八、常见问题

### 1. DNS 已改，但收不到外部邮件

优先检查：

1. 公网 `25/tcp` 是否真的可达
2. 云平台安全组是否放通
3. `mail.<your-domain>` 是否为 `DNS only`
4. MX 是否已经生效

### 2. 后台能看到邮件，但搜索不好用

检查：

1. `18080` 后端是否为新版本
2. 浏览器是否强刷过前端资源
3. 搜索的是首页侧边栏还是 `/html/mailboxes.html`

### 3. 泛子域能否收件

可以，前提是：

1. `*.<your-domain> MX` 已指向 `mail.<your-domain>`
2. VPS `25` 端口可达
