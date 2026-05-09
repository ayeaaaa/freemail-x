# Freemail AI 部署执行说明

这份文档用于让 AI 代理、自动化脚本或远程助手按照固定步骤部署当前仓库。

目标：

- 在 VPS 部署 `freemail-db-api`
- 在 VPS 部署 `tools/smtp-test` 作为 SMTP 直收入口
- 配置 DNS / MX 指向 VPS
- 验证根域与泛子域收件

## 一、执行原则

AI 执行时必须遵守：

1. 先读当前远端状态，再修改
2. 不要直接覆盖未知服务文件
3. 修改前先备份原服务文件
4. 修改后必须验证：服务状态、端口监听、日志、数据库入库
5. 不要擅自删除旧 DNS，除非已经确认新链路可用

## 二、输入参数

执行前准备以下变量：

```text
VPS_HOST=<server-host>
VPS_USER=root
APP_DIR=/opt/freemail-db-api
SMTP_DIR=/opt/freemail-smtp-ingress
APP_PORT=18080
SMTP_PORT=25
ADMIN_NAME=admin
ADMIN_PASSWORD=<admin-password>
JWT_TOKEN=<jwt-token>
DB_API_TOKEN=<db-api-token>
MAIL_DOMAIN=<comma-separated-root-domains>
MAIL_HOST=mail.<your-domain>
MAIL_IPV4=<your-ipv4>
MAIL_IPV6=<your-ipv6>
TARGET_DOMAIN=<your-domain>
```

## 三、部署步骤

### Step 1. 检查环境

执行：

1. 检查 Node / npm
2. 检查 PostgreSQL 是否可访问
3. 检查 `APP_PORT` 是否空闲或已有正确服务
4. 检查 `SMTP_PORT` 是否监听
5. 检查防火墙和安全组

最少验证命令：

```bash
node -v
npm -v
ss -lnt
systemctl status freemail-db-api --no-pager || true
systemctl status freemail-smtp-ingress --no-pager || true
```

### Step 2. 部署后端

1. 上传项目到 `APP_DIR`
2. 安装依赖
3. 创建或更新 `freemail-db-api.service`
4. 服务环境变量必须包含：
   - `PORT`
   - `ADMIN_NAME`
   - `ADMIN_PASSWORD`
   - `JWT_TOKEN`
   - `DB_API_TOKEN`
   - `MAIL_DOMAIN`
5. 启动服务并验证 `systemctl status`

### Step 3. 部署 SMTP 入口

1. 上传 `tools/smtp-test` 到 `SMTP_DIR`
2. 执行 `npm install`
3. 创建或更新 `freemail-smtp-ingress.service`
4. 服务环境变量必须包含：
   - `SMTP_PORT`
   - `DB_API_URL=http://127.0.0.1:18080`
   - `DB_API_TOKEN`
5. 启动并验证 `ss -lnt | grep :25`

### Step 4. 配置 DNS / MX

如果拥有 DNS 写权限，按以下顺序：

1. 创建 `MAIL_HOST` 的 A 记录
2. 创建 `MAIL_HOST` 的 AAAA 记录
3. 设置 `TARGET_DOMAIN MX 10 MAIL_HOST`
4. 如需要泛子域：设置 `*.TARGET_DOMAIN MX 1 MAIL_HOST`
5. 如果根域被 Email Routing 托管，先解锁或禁用托管 MX

### Step 5. 验证

必须依次验证：

1. `host -t mx TARGET_DOMAIN`
2. `host MAIL_HOST`
3. 本机 SMTP 测试
4. Gmail 外部发信测试
5. 数据库入库
6. 前端页面可见

### Step 6. 记录结果

AI 在结束时必须输出：

1. 部署目录
2. systemd 服务名
3. 实际监听端口
4. 真实生效的 MX
5. 根域测试是否通过
6. 泛子域测试是否通过
7. 是否仍依赖 Worker

## 四、验证命令模板

### 1. SMTP 监听

```bash
ss -lnt | grep :25
```

### 2. 服务日志

```bash
journalctl -u freemail-smtp-ingress -n 50 --no-pager
journalctl -u freemail-db-api -n 50 --no-pager
```

### 3. 本地 SMTP 测试

```bash
cd /opt/freemail-smtp-ingress
SMTP_TEST_RECIPIENT="test@<your-domain>" npm run send:test
```

### 4. DNS 检查

```bash
host -t mx <your-domain>
host mail.<your-domain>
```

## 五、失败时的排查顺序

如果外部邮件收不到，必须按这个顺序查：

1. DNS 是否已刷新
2. `mail.<your-domain>` 是否是 `DNS only`
3. VPS 的 `25/tcp` 是否公网可达
4. 云安全组是否已放通 `25/tcp`
5. `freemail-smtp-ingress` 是否在监听
6. `DB_API_URL/inbound-email` 是否可用
7. PostgreSQL 是否正常写入

## 六、禁止事项

AI 执行时不要做这些事：

1. 不要直接删除用户现有服务文件而不备份
2. 不要修改 Git 全局配置
3. 不要使用破坏性 git 命令
4. 不要在未确认 MX 生效前删除旧收件链路
5. 不要假设所有域名都应迁移到 VPS
