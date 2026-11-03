# 批量添加域名区分“新增/已存在跳过” — 设计文档

日期：2026-10-06
状态：已与用户确认设计方向，待写实施计划

## 问题

批量添加域名（`public/js/app.js` 逗号分隔提交）时，后端 `POST /api/domains` 使用 `INSERT ... ON CONFLICT (domain) DO NOTHING`，已存在的域名也返回 `{ success: true }`。前端因此把已存在的域名计入“已添加”，toast 只显示 `已添加 N 个域名`，用户无法知道哪些是新增、哪些被跳过。

## 目标

批量添加时 toast 汇总区分：新增数量、已存在跳过数量、失败数量。不改变批量解析（逗号分隔、trim、小写、批内去重）和数据库去重行为。

## 方案（后端权威）

### 后端（`.remote-freemail-server.mjs`，部署到 VPS）

`POST /api/domains` 改为：

```js
const result = await pool.query(
  'INSERT INTO domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING domain',
  [domain]
);
const created = result.rowCount > 0;
send(res, 200, { success: true, domain, created });
```

- `created: true` = 本次新增；`created: false` = 已存在、已跳过
- 响应仅新增字段，原有 `success`/`domain` 不变，域名迁移工具（`tools/domain-migrator/server.mjs`）等既有调用方不受影响

### 前端（`public/js/app.js` 批量添加处理器）

逐个调用 `POST /api/domains`，读取响应体 `created`，统计三个计数：`createdCount`、`skippedCount`、`failedCount`（请求抛错/非 2xx 计失败）。

Toast 规则（为 0 的项不显示）：

| 条件 | 文案 | 样式 |
|---|---|---|
| 有新增，无失败 | `新增 X 个`（有跳过追加 `，已存在跳过 Y 个`） | success |
| 有新增，有失败 | `新增 X 个，已存在跳过 Y 个，失败 Z 个` | warn |
| 无新增，有跳过，无失败 | `已存在跳过 Y 个（域名均已存在）` | warn |
| 无新增，无跳过，有失败 | `添加失败 Z 个` | error |

输入框清空与域名列表刷新逻辑保持现状：有新增（`createdCount > 0`）时清空输入并刷新域名列表；全部跳过时也清空输入（无内容可重试）。

## 修改文件

- `.remote-freemail-server.mjs`：POST /api/domains 使用 `RETURNING domain` + `rowCount`，响应加 `created`
- `public/js/app.js`：批量添加处理器统计与 toast 文案
- `tests/batch-domain-skip.test.mjs`（新增）：静态断言后端 `RETURNING`/`rowCount`/`created`，前端 `createdCount`/`skippedCount`
- `tests/batch-domain-add-parse.test.mjs`：保留既有解析断言；若引用旧变量名 `successCount` 需同步更新

## 测试与验证

1. `node tests/*.test.mjs` 全部通过
2. 部署后端与前端到 VPS（scp + md5 校验）
3. curl 验证：
   - POST 已存在域名 → `{ success: true, domain, created: false }`
   - POST 新域名 → `{ success: true, domain, created: true }`，随后 DELETE 清理测试域名
4. 浏览器（Playwright，可选）：批量输入“1 个已存在 + 1 个新域名”，确认 toast 显示 `新增 1 个，已存在跳过 1 个`

## 非目标

- 不改变单域名添加接口的既有字段与状态码语义
- 不实现前端预查询去重（避免竞态）
- 不列出具体被跳过的域名（用户已选择汇总数量）
- 不调整失败域名的保留/重试交互（维持现状）
