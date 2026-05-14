# 域名自动迁移脚本说明

仓库提供了一个脚本，可以在输入域名和 Cloudflare API Token 后，自动把域名迁到 VPS 直收方案。

脚本位置：

- `scripts/migrate-domain-to-vps.mjs`

## 一、用途

这个脚本默认针对当前仓库已经验证过的直收架构：

```text
域名 MX
-> mail.<domain>
-> VPS:25
-> SMTP ingress
-> /inbound-email
-> PostgreSQL
```

脚本会自动：

1. 查找 Cloudflare zone
2. 创建 `mail.<domain>` 的 A 记录
3. 创建 `mail.<domain>` 的 AAAA 记录
4. 创建根域 MX 记录
5. 创建泛子域 MX 记录
6. 删除 `*.<domain>` 上旧的 Cloudflare `route1/2/3.mx.cloudflare.net` 记录

## 二、使用方式

```bash
npm run migrate:domain -- --domain example.com --token <cloudflare-api-token>
```

例如：

```bash
npm run migrate:domain -- --domain saoyk.cyou --token cf_xxxxx
```

## 三、可选环境变量

默认值：

```bash
VPS_IPV4=129.213.16.4
VPS_IPV6=2603:c020:401c:5900:0:f375:c928:2f01
CF_DNS_TTL=120
```

如果你换了 VPS，可以这样指定：

```bash
VPS_IPV4=1.2.3.4 VPS_IPV6=2001:db8::1 npm run migrate:domain -- --domain example.com --token cf_xxxxx
```

## 四、脚本限制

### 1. 根域被 Email Routing 托管时

如果根域当前仍被 Cloudflare Email Routing 托管，脚本不会强行覆盖根域 MX。

它会提示：

1. 先去 Cloudflare 后台解锁或关闭 Email Routing
2. 再重新运行脚本

### 2. Zone 未激活时

如果 Cloudflare zone 还是 `pending`：

1. 脚本仍会写入记录
2. 但外部 DNS 不一定立刻能解析
3. 要等 zone 变成 `active` 后外部才会生效

## 五、成功后的预期结果

如果一切正常，脚本执行后你应该得到：

1. `mail.<domain> A -> VPS IPv4`
2. `mail.<domain> AAAA -> VPS IPv6`
3. `<domain> MX 10 -> mail.<domain>`
4. `*.<domain> MX 1 -> mail.<domain>`

## 六、执行后建议

脚本执行完后，建议手动再验证一次：

```bash
host -t mx <domain>
host -t mx foo.<domain>
host mail.<domain>
```

然后再发测试邮件到：

1. `test@<domain>`
2. `test@foo.<domain>`
