# 统一导航设计

日期：2026-10-04
状态：已与用户确认设计方向，待写实施计划

## 问题

各页面导航混乱，入口各不相同，且部分链接失效：

```text
主页面      GitHub | 用户管理 | 所有邮箱 | 域名迁移(死链) | 退出
管理页      返回邮箱 | 退出
所有邮箱    首页 | GitHub | 退出
邮箱详情    GitHub | 退出（没有首页）
域名迁移    返回管理页 | 返回首页
```

问题点：

1. 每个页面能到达的页面不同，无法从任意页到达任意页
2. "域名迁移"指向已失效的服务（asbarm02:18100 已死，本地 API 也返回 404）
3. GitHub 链接不需要
4. 管理入口的显隐逻辑只在主页面生效，其他页面没有

## 目标

所有页面使用同一套导航，任意页面可达任意页面：

```text
首页 | 所有邮箱* | 用户管理* | 退出登录 | [主题切换器]
```

`*` 管理入口按角色显示：超级管理员（strictAdmin）和演示模式（guest）可见，其他角色隐藏。规则与现有 `session.js` 一致。

## 方案

静态统一导航 + 共享可见性脚本（用户已确认）。

### 各页面导航改动

| 页面 | 改动 |
|---|---|
| 主页面（app.html 片段） | 去掉 GitHub、域名迁移；保留 所有邮箱、用户管理、退出；补首页 |
| 用户管理页（admin.html） | 去掉"返回邮箱"按钮；加 首页、所有邮箱、用户管理（当前页） |
| 所有邮箱页（mailboxes.html） | 去掉 GitHub；加 用户管理；保留 首页、退出 |
| 邮箱详情页（mailbox.html） | 加 首页、所有邮箱*、用户管理*（邮箱角色下管理入口隐藏） |
| 域名迁移页（domain-migrate.html） | 换成同一套导航（页面不再被链接，但保持一致） |

统一导航结构（所有页面相同）：

```html
<a class="btn btn-ghost" href="/">首页</a>
<a class="btn btn-ghost nav-admin-link" data-nav-admin href="/html/mailboxes.html">所有邮箱</a>
<a class="btn btn-ghost nav-admin-link" data-nav-admin href="/html/admin.html">用户管理</a>
<button id="logout" class="btn btn-secondary">退出登录</button>
```

管理入口默认 `display:none`，由 nav.js 根据角色显示。

### 新增共享脚本 `public/js/nav.js`

职责：

1. 请求一次 `/api/session`（带 `Cache-Control: no-cache`）
2. 若 `session.strictAdmin` 或 `session.role === 'guest'`：显示所有 `[data-nav-admin]` 入口；否则保持隐藏
3. 高亮当前页面对应的入口（比较 `location.pathname` 与链接 href，加 `is-active` 类）
4. 用 MutationObserver 兼容主页面片段异步加载的时序（主页面 nav 在 app.html 片段里，晚于脚本执行）
5. 请求失败时保持管理入口隐藏（fail-closed）

不负责：

- 退出按钮绑定（各页面现有逻辑不动）
- 主题切换器（theme.js 已有）

### 配套调整

1. `session.js` 中旧的入口显隐逻辑（`adminLink`、`allMailboxesLink`、`domainMigrateLink` 部分）移除，由 nav.js 统一接管，避免两套逻辑冲突。角色徽章逻辑保留。
2. 高亮样式加入 `components.css`：

```css
.btn-ghost.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}
```

3. 每个页面在 `theme.js` 之前引入 `<script src="/js/nav.js"></script>`。

## 不改的部分

- 退出登录的绑定逻辑（各页面 JS 不动）
- 页面权限守卫（admin.html / mailbox.html 的鉴权脚本不动）
- theme.js 主题切换器
- 后端与 API

## 验证

### 源码测试 `tests/nav-unified.test.mjs`

```text
- 5 个页面都引用 /js/nav.js
- 5 个页面都含统一入口：首页、所有邮箱、用户管理、退出登录
- 管理入口都带 data-nav-admin 标记且默认隐藏
- 5 个页面都不再含 github.com 链接（导航区域）
- 5 个页面都不再含 asbarm02 / 18100 死链
- nav.js 含角色规则（strictAdmin / guest）与高亮逻辑（is-active）
```

### 功能测试（mock DOM）

```text
- strictAdmin 会话 → 管理入口显示
- guest 会话 → 管理入口显示
- 普通 user 会话 → 管理入口隐藏
- 会话请求失败 → 管理入口保持隐藏
- 当前路径 /html/admin.html → 用户管理入口加 is-active
```

### 部署与人工验证

- 静态文件部署到 VPS，不需要重启服务
- 用户逐页点击验证：任意页面可达任意页面，管理入口显隐正确
