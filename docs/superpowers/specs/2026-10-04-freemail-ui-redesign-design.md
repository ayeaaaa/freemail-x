# Freemail UI 现代化重设计 — 设计文档

日期：2026-10-04
状态：已与用户确认设计方向，待写实施计划

## 目标

对 Freemail 全部页面做现代化重设计，提供三套可选视觉风格（Calm / Warm / Tech），每套风格支持浅色与深色，共 6 种组合。用户可在界面中自由切换，选择持久化保存。

## 范围

页面：app.html（主页面）、login.html（登录）、mailbox.html（邮件详情）、mailboxes.html（我的邮箱）、admin.html（用户管理）。

不改动的部分：

- 不改任何 JS 业务逻辑、API、后端
- 保留全部 HTML 元素 ID、class 名、data 属性（保证 JS 选择器不失效）
- 不做功能增删

## 主题架构

### 切换机制

```text
<html data-style="calm|warm|tech" data-mode="light|dark">
```

- `data-style`：三套视觉风格
- `data-mode`：明暗模式
- 持久化：`localStorage["mf:ui-theme"] = {"style":"calm","mode":"light"}`
- 默认值：`calm` + 跟随系统 `prefers-color-scheme`
- 防闪烁：每个页面 `<head>` 内联小脚本，在样式加载前读取 localStorage 并设置属性

### 切换入口

顶栏调色板图标按钮，点击弹出面板：

```text
┌─────────────────────────┐
│ 风格                     │
│ [Calm] [Warm] [Tech]    │  ← 三张风格卡片，带色块预览
│ 明暗                     │
│ [浅色] [深色]            │  ← 分段开关
└─────────────────────────┘
```

面板在 app.html、mailboxes.html、admin.html、mailbox.html 的顶栏可用；login.html 使用独立的简洁切换按钮（右下角固定）。

### 新增文件

```text
public/css/tokens.css          6 组设计令牌 + 基础重置
public/css/components.css      统一组件层（按钮/输入/卡片/弹窗/徽章/Toast）
public/css/theme-switcher.css  切换器样式
public/js/theme.js             切换逻辑（读写 localStorage、设置属性、渲染面板）
public/theme-preview.html      阶段 1 预览页（展示全部组件 × 6 组合）
```

### 迁移与退役

全部页面 CSS 迁移到令牌（`var(--token)`）：

```text
重写：main.css, app.css, app-sidebar.css, app-modal.css, app-compose.css,
      app-mailbox.css, app-responsive.css, app-mobile.css, login.css,
      mailbox.css, mailboxes.css, mailboxes-subpage.css, mailboxes-toolbar.css,
      admin.css
退役：全部 *_black.css（11 个文件），深色统一由令牌实现
保留备份：部署时旧文件改名 .bak 留在服务器，可回滚
```

## 设计令牌

### 结构令牌（三套风格共用，值随风格变化）

```text
--font-sans: -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace
间距刻度（固定）：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40
```

### Calm — 冷静克制（参考 Linear / Resend）

浅色：

```text
--bg: #fafafa          --surface: #ffffff      --surface-2: #f4f4f5
--text: #18181b        --text-2: #52525b       --text-3: #71717a
--border: #e4e4e7      --border-strong: #d4d4d8
--accent: #4f46e5      --accent-hover: #4338ca --accent-soft: #eef2ff
--danger: #dc2626      --success: #16a34a      --warning: #d97706
--radius-sm: 6px       --radius-md: 8px        --radius-lg: 12px
--shadow: 0 1px 2px rgba(0,0,0,.05)
```

深色：

```text
--bg: #09090b          --surface: #18181b      --surface-2: #1f1f23
--text: #fafafa        --text-2: #d4d4d8       --text-3: #a1a1aa
--border: #27272a      --border-strong: #3f3f46
--accent: #6366f1      --accent-hover: #818cf8 --accent-soft: #1e1b4b
--danger: #ef4444      --success: #22c55e      --warning: #f59e0b
--radius-sm: 6px       --radius-md: 8px        --radius-lg: 12px
--shadow: 0 1px 2px rgba(0,0,0,.4)
```

### Warm — 温暖友好（参考 Notion / Arc）

浅色：

```text
--bg: #faf9f7          --surface: #ffffff      --surface-2: #f5f4f2
--text: #292524        --text-2: #57534e       --text-3: #78716c
--border: #e7e5e4      --border-strong: #d6d3d1
--accent: #ea580c      --accent-hover: #c2410c --accent-soft: #fff7ed
--danger: #dc2626      --success: #16a34a      --warning: #d97706
--radius-sm: 10px      --radius-md: 14px       --radius-lg: 18px
--shadow: 0 4px 12px rgba(0,0,0,.06)
```

深色：

```text
--bg: #1c1917          --surface: #292524      --surface-2: #33302c
--text: #fafaf9        --text-2: #d6d3d1       --text-3: #a8a29e
--border: #44403c      --border-strong: #57534e
--accent: #fb923c      --accent-hover: #fdba74 --accent-soft: #431407
--danger: #ef4444      --success: #22c55e      --warning: #f59e0b
--radius-sm: 10px      --radius-md: 14px       --radius-lg: 18px
--shadow: 0 4px 12px rgba(0,0,0,.5)
```

### Tech — 深色科技（参考 GitHub Dark / shadcn）

深色（主）：

```text
--bg: #0a0e14          --surface: #11161f      --surface-2: #161c27
--text: #e6edf3        --text-2: #b3bcc7       --text-3: #8b949e
--border: #21262d      --border-strong: #30363d
--accent: #22d3ee      --accent-hover: #67e8f9 --accent-soft: #083344
--danger: #f87171      --success: #34d399      --warning: #fbbf24
--radius-sm: 4px       --radius-md: 6px        --radius-lg: 10px
--shadow: 0 1px 3px rgba(0,0,0,.5)
```

浅色：

```text
--bg: #f6f8fa          --surface: #ffffff      --surface-2: #eef1f4
--text: #1f2328        --text-2: #424a53       --text-3: #656d76
--border: #d0d7de      --border-strong: #afb8c1
--accent: #0891b2      --accent-hover: #0e7490 --accent-soft: #ecfeff
--danger: #cf222e      --success: #1a7f37      --warning: #9a6700
--radius-sm: 4px       --radius-md: 6px        --radius-lg: 10px
--shadow: 0 1px 3px rgba(0,0,0,.08)
```

## 组件语言

```text
顶栏       56px 高，sticky，surface 底 + backdrop-blur，底部 1px 边框
按钮       primary(accent 底) / secondary(surface+边框) / ghost / danger
           高度 sm=28px md=36px，radius 用 --radius-md
输入框     高度 36px，边框 --border，focus 时 accent 描边（2px ring）
卡片       surface 底 + 1px 边框 + --radius-lg + 20px 内边距 + --shadow
侧栏列表项 高度 34px，hover 用 --surface-2，选中用 --accent-soft + accent 文字
弹窗       遮罩 rgba(0,0,0,.4)+blur，卡片居中，radius-lg
Toast      右下角，surface 卡片 + 边框，成功/错误用 success/danger 左侧色条
徽章       pill 形，背景 tinted（accent-soft / success 等）
验证码     Tech 风格下用 --font-mono 展示
```

## 迁移策略

1. 先建 tokens.css / components.css / theme-switcher.css / theme.js / theme-preview.html
2. 部署预览页到 VPS，用户确认 6 种组合效果
3. 逐页迁移：login → app → mailbox → mailboxes → admin
4. 每页迁移后：HTML 保留原 ID/class，只调整 link 引用与少量结构
5. 旧 CSS 与 *_black.css 部署时备份，可整页回滚

## 验证

```text
源码级测试：
- tokens.css 包含 3 风格 × 2 模式 = 6 组选择器
- HTML 引用 tokens.css + components.css + theme.js
- 迁移后的页面 CSS 不包含旧硬编码色值（抽查）
运行级验证（部署到 VPS 后）：
- 全部页面与静态资源 HTTP 200
- theme-preview.html 展示 6 组合切换正常
- 用户浏览器目视确认
回滚：服务器旧文件 .bak 恢复即可
```

## 分阶段交付

```text
阶段 1：令牌 + 组件层 + 切换器 + 预览页（本次）
阶段 2：全部页面迁移（预览确认后）
```
