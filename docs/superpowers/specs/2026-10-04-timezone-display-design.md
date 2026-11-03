# 时间显示东八区修复 — 设计文档

日期：2026-10-04
状态：已与用户确认设计方向，待写实施计划

## 问题

数据库存储的时间格式为：

```text
2026-10-04 14:52:35.973538+00
```

这是 UTC 时间，`+00` 是**不带冒号**的时区后缀。JavaScript 的 `new Date()` 不识别这种格式，解析结果为 `Invalid Date`。前端所有时间格式化函数解析失败后都退回显示原始字符串。

结果：所有页面显示的是 UTC 原始时间（例如 `2026-10-04 14:52:35.973538+00`），而不是东八区时间（应为 `2026/10/4 22:52:35`）。

同时，按时间排序的比较器（`sortEmails`、`sortMailboxes`）也因解析失败而失效。

## 目标

全部页面的时间显示统一为东八区（`Asia/Shanghai`），格式 `2026/10/4 22:52:35`。按时间排序恢复正常。

## 方案

前端修复，不动后端和数据库。

### 新增共享解析函数 `parseServerTime(ts)`

放在 `public/js/core/utils.js`（共享工具模块），导出给所有模块使用。

解析规则：

| 输入格式 | 处理 |
|---|---|
| `2026-10-04 14:52:35.973538+00` | 空格转 `T`；`+00` 补全为 `+00:00`；解析 |
| `2026-10-04T14:52:35.973538Z` | 直接解析 |
| `2026-10-04T22:52:35+08:00` | 直接解析 |
| `2026-10-04 14:52:35`（无时区） | 视为 UTC，补 `Z` 解析 |
| `2026-10-04`（纯日期） | 直接解析（按 UTC 零点） |
| 数字 | 按毫秒时间戳解析 |
| 空值 / 无法解析 | 返回 `null` |

关键细节：`+00` 补冒号的正则必须锚定在时间部分之后，避免把纯日期 `2026-10-04` 结尾的 `-04` 误判为时区。

### 格式化

所有格式化函数改为：用 `parseServerTime` 解析，`Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, ... })` 输出。解析失败时保持现有回退行为（返回原始字符串），不丢信息。

### 修改文件

```text
public/js/core/utils.js                      新增 parseServerTime；修 formatTime、formatRelativeTime
public/js/modules/app/ui-helpers.js          修 formatTs、formatTsMobile（改用共享解析）
public/js/modules/mailbox/email-list.js      修 formatTime、sortEmails 比较器
public/js/modules/mailboxes/render.js        修 formatTime
public/js/modules/mailboxes/grid-view.js     修 formatTime
public/js/modules/mailboxes/filters.js       修 sortMailboxes 比较器
public/js/modules/admin/user-list.js         修 formatTime
public/js/modules/app/email-viewer.js        内联解析改为共享解析（保持无秒显示）
public/js/modules/app/compose.js             发件箱 created_at 原文显示改为格式化
```

`email-detail.js`、`mailbox.js`、`mailboxes.js`、`admin.js` 等通过上述模块间接生效，无需改动。

### 不改的部分

- 后端与数据库存储格式不变
- `mock.js`、`mock-api.js`（mock 数据）不处理
- 页面 HTML 结构、其他 JS 逻辑不变

## 验证

新增 `tests/time-format.test.mjs`（Node 直接导入真实模块断言）：

```text
parseServerTime('2026-10-04 14:52:35.973538+00') → UTC 2026-10-04 14:52:35.973
parseServerTime('2026-10-04 14:52:35')           → 同上（视为 UTC）
parseServerTime('2026-10-04T14:52:35.973Z')      → 同上
parseServerTime('2026-10-04T22:52:35+08:00')     → UTC 2026-10-04 14:52:35
parseServerTime('') / 垃圾字符串                  → null
formatTs('2026-10-04 14:52:35.973538+00')        → '2026/10/4 22:52:35'
formatTs('2026-10-04T22:52:35+08:00')            → '2026/10/4 22:52:35'
sortEmails 混合时区输入按真实时间排序
```

部署：静态文件复制到 VPS，不需要重启服务；验证 md5 一致 + 页面 HTTP 200；浏览器硬刷新后目视确认。
