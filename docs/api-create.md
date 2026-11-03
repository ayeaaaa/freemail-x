# /api/create 邮箱创建接口说明

`/api/create` 用于创建一个可接收邮件的邮箱地址。创建成功后，该邮箱会进入 Freemail 系统，可以通过收件接口或网页查看收到的邮件。

## 接口地址

```http
POST http://asbarm02.v4.example.com:18080/api/create
```

## 认证方式

推荐使用 API Token 调用。

```http
Authorization: Bearer 你的API_TOKEN
Content-Type: application/json
```

如果是在已登录的浏览器页面里调用，也可以使用登录 Cookie。但脚本、第三方系统、自动化程序建议统一使用 `Authorization: Bearer ...`。

## 请求参数

支持三种创建方式。

### 方式一：直接指定完整邮箱

```json
{
  "email": "test@charlot2312.indevs.in"
}
```

这是最推荐的方式。后端会自动把 `email` 拆分成邮箱前缀和域名。

### 方式二：指定邮箱前缀和域名

```json
{
  "local": "test",
  "domain": "charlot2312.indevs.in"
}
```

适合前端或业务系统自己控制邮箱前缀和域名的场景。

### 方式三：指定邮箱前缀和域名序号

```json
{
  "local": "test",
  "domainIndex": 0
}
```

`domainIndex` 是系统域名列表里的下标，从 `0` 开始。

不建议外部系统长期依赖 `domainIndex`，因为后台域名顺序变化后，创建出来的邮箱域名也可能变化。外部调用更推荐使用 `email` 或 `domain`。

## 参数说明

| 参数 | 类型 | 是否必填 | 说明 |
|---|---|---:|---|
| `email` | string | 否 | 完整邮箱地址，例如 `test@example.com`。优先级最高。 |
| `local` | string | 否 | 邮箱前缀，例如 `test`。 |
| `domain` | string | 否 | 指定域名，例如 `example.com`。 |
| `domainIndex` | number | 否 | 域名列表下标，从 `0` 开始，默认 `0`。 |

必须至少提供 `email`，或者提供 `local`。

如果同时提供了 `email` 和其他字段，以 `email` 为准。

## 邮箱前缀规则

`local` 只能包含以下字符：

```text
a-z
0-9
.
_
-
```

长度必须是 `1-64` 个字符。

合法示例：

```text
test
user_001
my.mail
abc-123
```

非法示例：

```text
中文
test+abc
abc@test
空字符串
```

## 域名要求

请求里的域名必须已经在 Freemail 域名列表中。

如果域名没有加入系统，会返回：

```json
{
  "error": "域名不在允许范围内"
}
```

如果你是通过独立域名迁移工具 `18100` 添加域名，建议勾选：

```text
迁移成功后自动加入 Freemail 域名列表
```

这样迁移成功后，域名会自动加入 `18080` 的 Freemail 域名列表，之后就可以直接通过 `/api/create` 创建该域名下的邮箱。

## curl 示例

### 创建指定完整邮箱

```bash
curl -X POST 'http://asbarm02.v4.example.com:18080/api/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 你的API_TOKEN' \
  -d '{"email":"test@charlot2312.indevs.in"}'
```

### 创建指定域名下的邮箱

```bash
curl -X POST 'http://asbarm02.v4.example.com:18080/api/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 你的API_TOKEN' \
  -d '{"local":"test","domain":"charlot2312.indevs.in"}'
```

### 使用第一个域名创建邮箱

```bash
curl -X POST 'http://asbarm02.v4.example.com:18080/api/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 你的API_TOKEN' \
  -d '{"local":"test","domainIndex":0}'
```

## 成功返回

```json
{
  "email": "test@charlot2312.indevs.in",
  "expires": 1781712345678
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `email` | string | 创建成功的邮箱地址。 |
| `expires` | number | 过期时间戳，毫秒。 |

## 常见错误

### 1. 邮箱格式错误

```json
{
  "error": "非法邮箱地址"
}
```

常见原因：

- `email` 没有 `@`
- `@` 前面为空
- `@` 后面为空
- 邮箱格式不完整

### 2. 邮箱前缀错误

```json
{
  "error": "非法用户名"
}
```

常见原因：

- `local` 为空
- `local` 超过 64 个字符
- `local` 包含中文、空格、`+`、`@` 等不支持字符

### 3. 域名不允许

```json
{
  "error": "域名不在允许范围内"
}
```

常见原因：

- 域名还没有加入 Freemail 域名列表
- 域名拼写错误
- 使用了还没有迁移完成的域名

### 4. 没有可用域名

```json
{
  "error": "未配置可用域名"
}
```

说明当前系统没有配置任何可用域名，需要先在后台添加域名。

### 5. 请求体格式错误

```json
{
  "error": "Bad Request"
}
```

常见原因：

- 请求体不是合法 JSON
- 没有设置 `Content-Type: application/json`

## 推荐调用方式

外部系统推荐使用完整邮箱方式：

```json
{
  "email": "业务自定义前缀@已加入系统的域名"
}
```

例如：

```json
{
  "email": "order123@example.com"
}
```

这样最清晰，也不会受到后台域名排序变化影响。
