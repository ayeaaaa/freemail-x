# 随机子域支持 0 级（根域名）— 设计文档

日期：2026-10-16
状态：已与用户确认设计方向，待写实施计划

## 问题

“随机子域层级”下拉只有 1–7 级，无法选择“不加子域、直接用根域名”。

同时三个创建入口行为不一致：

- 「随机生成邮箱」走后端 `/api/generate`，按 `subdomainLevels`（1–7，默认 1）生成 `local@xx.xx.xx.根域名`
- 「随机人名邮箱」「自定义邮箱」走后端 `/api/create`，而后端**未读取** `subdomainLevels`（`.remote-freemail-server.mjs:448` 直接 `local@domain`）→ 始终是根域名

结果：层级下拉只对「随机生成邮箱」生效，用户无法显式选择根域名，也无法让人名/自定义邮箱使用子域。

## 目标

- `subdomainLevels` 支持 `0`：`0` = 不加子域，直接用根域名；`N≥1` = 加 N 级随机子域
- 三个创建入口（随机生成 / 随机人名 / 自定义）行为一致，都遵守该设置
- 下拉默认值改为 `0`（根域名）

## 方案

### 语义

| `subdomainLevels` | 生成的地址 |
|---|---|
| `0`（默认） | `local@根域名` |
| `1` | `local@xxxxxx.根域名` |
| `N`（1–7） | `local@` + N 个随机标签以 `.` 连接 + `.根域名` |

越界值 clamp 到 `0–7`。

### 后端（`.remote-freemail-server.mjs`）

新增共享助手，供两个处理器复用：

```js
function buildAddressHost(domain, levels) {
  const count = Math.max(0, Math.min(7, Number(levels) || 0));
  return count > 0 ? `${buildRandomSubdomain(count)}.${domain}` : domain;
}
```

- `/api/generate`（约 476–478 行）：`subdomainLevels` clamp 由 `1–7` 放宽为 `0–7`（缺省 0）；`address = ${local}@${buildAddressHost(domain, subdomainLevels)}`
- `/api/create`（约 420–458 行）：读取 `data.subdomainLevels`（`0–7`，缺省 0）；由 `local` + `domain` 构造地址时使用 `buildAddressHost(domain, subdomainLevels)`；若请求携带完整 `email` 字段（`fullEmail`），则原样使用该地址，不叠加子域

`buildRandomSubdomain(levels, labelLength)` 保持不变（仅处理 `≥1`）。

### 前端

- `public/html/app.html`：`#subdomain-level-select` 新增 `<option value="0" selected>0 级（根域名）</option>`，并将 `3 级` 选项的 `selected` 移除
- `public/js/modules/app/mailbox-actions.js`：`getSubdomainLevels` 改为 `Math.max(0, Math.min(7, Number(elements?.subdomainLevelSelect?.value ?? 0) || 0))`（缺省 0）

### Guest 演示 mock（`public/js/modules/app/mock-api.js`）

`/api/generate` 与 `/api/create` 也按 `subdomainLevels` 生成随机子域（`0` = 根域名），与真实后端保持一致。子域标签使用现有 `mockGenerateId`。

## 修改文件

- `.remote-freemail-server.mjs`：新增 `buildAddressHost`；`/api/generate` 与 `/api/create` 使用它并放宽 clamp 到 0
- `public/html/app.html`：新增 `0 级（根域名）` 选项并设为默认
- `public/js/modules/app/mailbox-actions.js`：`getSubdomainLevels` clamp 改为 0–7、缺省 0
- `public/js/modules/app/mock-api.js`：两个 mock 处理器遵守 `subdomainLevels`
- `tests/subdomain-level.test.mjs`（新增）：静态断言

## 测试与验证

1. 静态测试 `tests/subdomain-level.test.mjs`：
   - 后端源码包含 `buildAddressHost` 且 clamp 为 `Math.max(0, Math.min(7`
   - 后端 `/api/create` 使用 `buildAddressHost`
   - 前端 `getSubdomainLevels` 使用 `Math.max(0`
   - `app.html` 含 `value="0"` 且带 `selected`
2. 全部测试：`for t in tests/*.test.mjs; do node "$t" ...; done` 全 PASS
3. 部署到 VPS（后端 `server.mjs` 重启服务；前端 `app.html`、两个 js 静态文件），md5 一致
4. 线上 curl（登录后带 Cookie）：
   - `/api/generate?length=8&domain=X&subdomainLevels=0` → 地址形如 `8位@X`（无子域）
   - `/api/generate?length=8&domain=X&subdomainLevels=2` → 地址形如 `8位@xx.xx.X`
   - `POST /api/create {local, domain, subdomainLevels:0}` → `local@X`
   - `POST /api/create {local, domain, subdomainLevels:2}` → `local@xx.xx.X`
   - 验证后删除这些测试邮箱
5. Playwright E2E：登录后选「0 级（根域名）」点「随机生成邮箱」，断言页面邮箱地址等于 `xxx@根域名`（不含多余子域）

## 兼容性

- `/api/generate` 缺省 `subdomainLevels` 由 `1` 改为 `0`（默认根域名，与用户选择一致）；前端始终显式传值，UI 行为不受此缺省变化影响
- `/api/create` 缺省保持 `0`（历史行为本就是根域名）
- `/api/create` 响应字段与状态码不变；带完整 `email` 的调用方行为不变
- 数据库 `domains` 的唯一约束与去重逻辑不受影响

## 非目标

- 不改变 `buildRandomSubdomain` 的随机标签长度与字符集
- 不新增“固定子域”功能（仅随机子域）
- 不调整子域收件（泛子域 MX）的服务端逻辑
