# Gloaming 前端设计基线审查

> 审查目的：为后续 User-first 前端迁移记录当前真实存在的页面、布局、视觉语言、组件和交互。遵循“Existing Gloaming Design > New AI-generated Design”。本文描述源码现状，不提出新 UI 方案，也不替代产品决策。

## 1. 审查范围

- **阶段：调查（只读审查）**。本轮只新增本文件；没有修改业务代码、UI、样式、路由、组件、API 或文案。
- **源码范围：** `apps/web/app` 下 26 个 `page.tsx` 路由文件、5 个 `layout.tsx` 文件；主要用户端和管理端页面组合点；导航、设计系统、主题与字体入口；`components/ui` 下 28 个基础组件文件；书籍/作品展示、Reader、账户与状态反馈的代表性组件。
- **设计来源：** `DESIGN.md`、`apps/web/app/globals.css`；页面行为以相应 route、feature 组件和 API client 为证据。
- **运行界面：** **Visual runtime verification not performed**。未启动开发服务；以下结构与响应式结论基于源码，不能当作运行时截图/浏览器验收。
- **限制：** 不审核后端实现和数据语义；数据来源只记录前端调用的 endpoint、query 或类型。API 实际返回内容可能因账号和数据而异。

### 盘点口径

- “页面数”按 `page.tsx` 路由文件计，包含 redirect route 和 Admin 页面；`/admin` 与几个 Admin 子路径只是别名，不代表额外独立界面。
- “核心组件数”分为 **28 个 `components/ui` 基础组件文件**（目录清点）和 **18 个导航、壳层、书籍展示、Reader、Auth、账户及状态模式的代表性组件/页面组件**（源码阅读）。两类合计 46 个组件模块；不是说每个原子组件均在每个页面中出现。
- “设计/token 文件数”指 2 个主要视觉定义文件：`DESIGN.md` 和 `apps/web/app/globals.css`。根 layout 中字体加载和 theme provider 属运行接线，未计入 Token 文件数。

## 2. Current Information Architecture

### 2.1 真实路由清单

路由按源码 route group 匹配，括号内是实际文件路径。桌面/移动描述针对源码中的结构性变化；没有运行浏览器验证。

| 页面 / 路径                                                  | 页面文件；Layout                                                           | 主要区域与职责                                                           | 主要 CTA / 数据来源                                                                                                               | 桌面 / 移动结构                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Landing `/`                                                  | `apps/web/app/page.tsx`；Root layout                                       | `LandingPage`：SiteNav、Hero、产品/阅读介绍、Shelf/陪伴叙事、CTA、Footer | 登录/进入书架 CTA；静态页面内容与本地 landing 资源                                                                                | Hero 与内容段落按断点调整列数；SiteNav 桌面显示主导航，移动收敛为品牌和账户入口 |
| Discover `/discover`                                         | `app/(app)/discover/page.tsx`；Root + App layout                           | 分类/标签筛选、作品网格、分页/继续加载、加载及错误态                     | 分类、标签、作品列表；`GET /api/catalog/categories`、`/api/catalog/tags`、`/api/catalog/works`，另以 `/api/shelf` 补充书架状态    | 桌面网格与分页；移动首屏列表、追加加载，网格列数减少                            |
| Discover detail `/discover/[workId]`                         | `app/(app)/discover/[workId]/page.tsx`；Root + App layout                  | 作品封面、标题/作者、分类/标签、简介/节选、相关作品与书架状态            | 阅读、加入书架/书架状态 CTA；目录作品详情/parts 与 `/api/shelf`                                                                   | 桌面 Hero 横排；移动纵向堆叠并有底部固定 CTA                                    |
| Shelf `/my-shelf`                                            | `app/(app)/my-shelf/page.tsx`；Root + App layout                           | 当前继续阅读 Hero（有数据时）、作品网格或空状态                          | 继续阅读、进入发现；`GET /api/shelf`，经 `ShelfData`                                                                              | 桌面网格更宽；移动单列 Hero 和较少网格列                                        |
| History `/reading-history`                                   | `app/(app)/reading-history/page.tsx`；Root + App layout                    | 历史摘要、热力图、作品记录列表或空状态                                   | 打开历史作品、进入发现；`GET /api/reading-history`                                                                                | 摘要桌面横排、移动 2×2；列表行在窄屏压缩次要元数据                              |
| Account `/account`                                           | `app/(app)/account/page.tsx`；Root + App layout                            | 个人资料、改邮箱、改密码                                                 | 保存资料变更；账户/session 查询和账户变更 API                                                                                     | 内容限宽；窄屏标签与字段纵向，宽屏表单字段更紧凑                                |
| More `/more`                                                 | `app/(app)/more/page.tsx`；Root + App layout                               | 头像/用户信息与账户入口                                                  | 打开 `/account`                                                                                                                   | 窄栏居中；主要服务移动底部导航的“更多”入口                                      |
| Reader `/read/[workId]`                                      | `app/(reader)/read/[workId]/page.tsx`；Root + Reader layout                | Reader 自有 Chrome、目录、正文、选区工具、AI/词典/TTS 交互               | 上/下章、目录、AI 辅助、查词/翻译、播放；`/api/reader/*`、`/api/dictionary/lookup`、assist/translate/conversations 与阅读心跳 API | Reader 单独占据阅读界面；移动目录/辅助面板改用 Sheet 等窄屏模式，正文限宽       |
| Auth error `/auth-error`                                     | `app/(auth)/auth-error/page.tsx`；Root + Auth layout                       | 认证错误说明与后续链接                                                   | 返回登录/重试                                                                                                                     | Auth 居中表单式面板                                                             |
| Reset password `/reset-password`                             | `app/(auth)/reset-password/page.tsx`；Root + Auth layout                   | 重置密码表单                                                             | 提交重置；认证 API                                                                                                                | Auth 居中面板，窄屏占满可用宽度                                                 |
| Verify email `/verify-email`                                 | `app/(auth)/verify-email/page.tsx`；Root + Auth layout                     | 邮件验证状态/重新发送入口                                                | 验证或重新发送；认证 API                                                                                                          | Auth 居中面板                                                                   |
| Admin index `/admin`                                         | `app/admin/page.tsx`；Root + Admin layout                                  | **redirect** 到 `/admin/works`，不是独立 dashboard                       | 跳转                                                                                                                              | 无独立页面布局                                                                  |
| Admin works `/admin/works`                                   | `app/admin/works/page.tsx`；Root + Admin layout                            | `WorksListPage`：作品管理列表、筛选/分页与操作                           | 新建、编辑、预览；`/api/admin/works`                                                                                              | 桌面管理区与侧边栏；窄屏使用 Admin 菜单 Sheet，页面内容纵向滚动                 |
| Admin new work `/admin/works/new`                            | `app/admin/works/new/page.tsx`；Root + Admin layout                        | `WorksEditPage` 新作品表单/EPUB 导入工作流                               | 上传 EPUB、保存/继续后续处理；`/api/admin/works/epub`、相关管理 API                                                               | 表单分区；窄屏纵向排列。**这是 Admin 供给工具，不是用户上传页**                 |
| Admin edit work `/admin/works/[id]`                          | `app/admin/works/[id]/page.tsx`；Root + Admin layout                       | 复用 `WorksEditPage` 编辑现有作品                                        | 保存、预览、发布相关操作；`/api/admin/works/:id` 等                                                                               | 同新建页                                                                        |
| Admin work preview `/admin/works/[id]/preview`               | `app/admin/works/[id]/preview/page.tsx`；Root + Admin layout               | 作品预览和章节入口                                                       | 打开章节预览/返回编辑；作品详情与 parts API                                                                                       | Admin 内容区；窄屏纵向                                                          |
| Admin part preview `/admin/works/[id]/preview/part/[partId]` | `app/admin/works/[id]/preview/part/[partId]/page.tsx`；Root + Admin layout | 单个 part 的阅读预览                                                     | 上下文导航/返回作品预览；part 详情 API                                                                                            | 管理框架内的 Reader 式正文预览；窄屏纵向                                        |
| Admin assets `/admin/assets`                                 | `app/admin/assets/page.tsx`；Root + Admin layout                           | 资源扫描、对象列表、清理任务与状态                                       | 扫描、清理、重试；`/api/admin/assets/*`                                                                                           | 桌面表格/管理工作区；移动受 Admin 主区和滚动容器约束                            |
| Admin config `/admin/config`                                 | `app/admin/config/page.tsx`；Root + Admin layout                           | `AdminConfigCenter`；AI、TTS、Dictionary 配置 Tabs                       | 管理系统配置、测试连接/服务；`/api/admin/llm/*`、`/api/admin/tts/*`、`/api/admin/dictionary/*`                                    | Admin 内容区内 Tab；窄屏由 shell 菜单进入，面板按列收缩                         |
| Admin AI alias `/admin/ai`                                   | `app/admin/ai/page.tsx`；Root + Admin layout                               | **redirect** 到 `/admin/config?tab=ai`                                   | 跳转                                                                                                                              | 无独立页面                                                                      |
| Admin TTS alias `/admin/tts`                                 | `app/admin/tts/page.tsx`；Root + Admin layout                              | **redirect** 到 `/admin/config?tab=tts`                                  | 跳转                                                                                                                              | 无独立页面                                                                      |
| Admin Dictionary alias `/admin/dictionary`                   | `app/admin/dictionary/page.tsx`；Root + Admin layout                       | **redirect** 到 `/admin/config?tab=dictionary`                           | 跳转                                                                                                                              | 无独立页面                                                                      |
| Admin taxonomy `/admin/taxonomy`                             | `app/admin/taxonomy/page.tsx`；Root + Admin layout                         | 分类/标签管理                                                            | 创建、编辑、清理；`/api/admin/taxonomy/*`                                                                                         | 管理列表/表单；窄屏纵向                                                         |
| Admin log center `/admin/log-center`                         | `app/admin/log-center/page.tsx`；Root + Admin layout                       | `AdminLogsCenter`，AI/TTS/管理日志视图；Suspense skeleton                | 查询/筛选日志；`/api/admin/ai/invocations`、`/api/admin/tts/invocations` 等                                                       | Admin 内容区与表格/筛选；窄屏使用 shell 移动菜单                                |
| Admin AI log alias `/admin/ai-logs`                          | `app/admin/ai-logs/page.tsx`；Root + Admin layout                          | **redirect** 到 Admin log center 的 AI tab                               | 跳转                                                                                                                              | 无独立页面                                                                      |
| Admin TTS log alias `/admin/tts-logs`                        | `app/admin/tts-logs/page.tsx`；Root + Admin layout                         | **redirect** 到 Admin log center 的 TTS tab                              | 跳转                                                                                                                              | 无独立页面                                                                      |

### 2.2 当前明确不存在的用户页面

- `/settings`：**Not implemented**。目前账户资料与邮箱/密码变更在 `/account`；外观、语言通过顶部账户/主题菜单操作。Admin 有 AI/TTS/Dictionary 的**系统级管理配置**，不是用户 BYOK Settings。
- 用户侧 `/library`：**Not implemented**。当前对应用户集合页是 `/my-shelf`，界面称呼来自本地化 Shelf 文案；数据从 `/api/shelf` 读取。
- 用户侧 EPUB Upload：**Not implemented**。可见的上传编辑流位于 Admin `/admin/works/new`，不能视为用户上传能力。
- 登录/注册没有独立 `/login` 或 `/register` 页面；表单在全局 Auth Dialog 流程中。密码重置、验证邮件和认证错误则是独立路由。
- 独立 `/profile`：**Not implemented**；资料在 `/account`。

## 3. Navigation

### 用户导航

| 表面              | 顺序 / 项目                  | 图标与 label                                                                    | Active / 差异                                                                                  |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Desktop top nav   | 发现 → 书架 → 历史           | 顶栏文字链接，无导航图标                                                        | `matchesNavPath`：当前路径等于 href 或为其子路径时 active；断点以下隐藏                        |
| Mobile bottom nav | 书架 → 发现 → 历史 → 更多    | `BookMarked`、`Compass`、`History`、`MoreHorizontal`；每项图标 + 本地化短 label | 同一 active 匹配；固定底部、考虑 safe area；仅 AppShell 出现，不在 Landing、Reader、Admin 出现 |
| SiteNav 右侧      | 主题、头像菜单；未登录时登录 | 太阳/月亮；头像/首字母                                                          | 主题提供 Light/Dark/System；账户菜单含账户中心、管理员入口（符合权限时）、语言、退出           |
| Mobile More       | 头像/账户入口                | More tab 打开 `/more`，页面行跳 `/account`                                      | 桌面没有同名 More 页面入口；账户菜单直接提供 Account                                           |

### Admin、Reader 导航

- Admin Shell 桌面侧栏顺序：Works（`FileText`）、Assets（`HardDrive`）、Config（`Settings`）、Taxonomy（`Tags`）、Logs（`ScrollText`）；移动端由顶部菜单按钮打开 Sheet。Shell 提供返回用户书架的链接。AI/TTS/Dictionary 与日志子类型作为中心页内 Tab，而 `/admin/ai`、`/admin/tts`、`/admin/dictionary`、`/admin/ai-logs`、`/admin/tts-logs` 是兼容跳转路径。
- Reader 不继承 SiteNav 或 MobileBottomNav。Reader Chrome 含返回、目录、作品/章节上下文、字体大小、AI 辅助、TTS 等控制；目录通过桌面侧栏或移动 Sheet 导航章节，并提供上一章/下一章行为。返回目的地由进入上下文/浏览历史决定，当前没有统一的产品级 Library/Discover/History 选项。

### 用户侧导航现状需讨论之处

`Shelf / Discover / History / Settings / Account` 中，前三者是主导航；Settings 没有页面或导航项；Account 在桌面头像菜单、移动 More 页面中出现。Shelf 的 URL 保留 `/my-shelf`。名称与入口迁移问题见第 21 节；本审查不裁定。

## 4. Visual Language

`DESIGN.md` 将视觉方向定义为 **Calm Paper-First / Modern Editorial**：暖纸色、低噪声、留白承载层级、单一 ember 橙色强调，阅读正文优先于工具 Chrome。源码实现集中在语义 CSS variables 与 Base UI/shadcn primitives。

| 属性                 | 源码/规范中可确认的现状                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background / Surface | Light：暖纸 `#fff8f5` 一系；白色/暖灰的 surface-container 分层；`background`、`card`、`muted` 等语义变量映射 CSS colors。Dark：暖夜色 `#1c1816`、非纯黑，分层 surface。 |
| Border / Divider     | 语义 `border` / `outline-variant`，边线通常偏暖、低对比；站点导航分隔边使用半透明 border。                                                                              |
| Radius               | Token 包含 4/8/12/16/24px 与 pill；项目惯例将控件/CTA 设为 12px，面板 16px；Auth CTA 为 pill。页面会以 Tailwind 类表达具体圆角。                                        |
| Shadow               | 以 surface 色阶作为层次；CSS 有 `shadow-card`、`shadow-floating`，不是全站重阴影。                                                                                      |
| Typography           | 标题/阅读用 Source Serif 4 + Noto Serif SC；UI 用 Source Sans 3 + Noto Sans SC；具体比例见第 6 节。                                                                     |
| Accent               | 单一 ember/burnt-orange 家族；按钮、active 与少量强调复用 primary/brand/accent 语义 token。                                                                             |
| Button / Input       | `components/ui/button.tsx` 等提供 variant/size；Field/Input/Select/Combobox/Tabs 等基元与 Tailwind 组合；主要页面按钮圆角和语义状态来自 token。                         |
| Icon                 | 主要为 `lucide-react`；导航图标线宽较轻；装饰性封面另有自绘/渐变/字形呈现。                                                                                             |
| Spacing / Container  | Design YAML 声明 mobile margin 24px、gutter 32px、stack 16/32/64px、内容上限 1200px、阅读列 680px；`globals.css` 的 container utility 实现横向 padding 和最大宽度。     |
| Page / Section       | AppShell 主内容 `container` + 纵向页面 padding；管理页面更密集，常用 max-width 内容面板、表格和紧凑控件。                                                               |

上述是规范与类名证据，不代表视觉运行验收。实现页面仍需沿用语义变量，不从截图或单页颜色推导新调色板。

## 5. Layout System

| Layout       | 文件 / 组件                            | 当前作用                                                        | 可承载的新页面                                                  |
| ------------ | -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Root         | `apps/web/app/layout.tsx`              | 全局字体、Providers、主题与 Toast 等应用接线                    | 所有路由共同根布局                                              |
| App shell    | `app/(app)/layout.tsx` → `AppShell`    | SiteNav、滚动主内容、MobileBottomNav；认证 pending/loading 处理 | Library、Settings 若属于普通用户主流程，现有承载入口是 AppShell |
| Auth shell   | `app/(auth)/layout.tsx` → `AuthLayout` | AuthIntro/AuthPanel 式居中身份验证页面框架                      | 认证流程页面                                                    |
| Reader shell | `app/(reader)/layout.tsx`              | 不复用 AppShell；Reader 自有布局、Chrome 与阅读区               | Reader 相关页面，不是通用设置布局                               |
| Admin shell  | `app/admin/layout.tsx` → `AdminShell`  | 桌面 288px 左侧栏；移动 Sheet；独立管理内容滚动区               | 管理端，不是用户侧页面承载框架                                  |

新用户页若维持当前信息架构，AppShell、container、顶部栏/移动底栏可直接作为既有骨架；是否保留旧 URL 与导航命名需要人工讨论。

## 6. Design Tokens

主要来源共 2 个：

1. `DESIGN.md`：YAML front matter 是设计值 SSOT；含 light/dark 色板、圆角、字号、字体、间距、容器、主题模式及文字/交互原则。
2. `apps/web/app/globals.css`：Tailwind v4 `@theme inline` 与 CSS custom properties 的运行实现；语义 light/dark variables、container utility、`font-reading`、shadow 及全局 motion/reduced-motion 规则。

运行主题通过 `next-themes`，`attribute="class"`、默认 `system`、`enableSystem`，以 `html.dark` 切换；Light/Dark/System 入口在 `ThemeModeNavButton`。常规 UI 用 CSS semantic variables，ThemeProvider 统一应用；Reader 没有独立配色模式，沿用全局主题变量并使用阅读专属正文样式。源码全局搜索中原始 hex 色值集中在 `globals.css` 和图表配色实现 `components/ui/chart.tsx`，未在主要用户页面 feature CSS 中发现单独主题表。后续页面应复用既有 semantic tokens 与 theme provider。

## 7. Reusable Components

### 7.1 基础组件目录盘点（28 个 `components/ui/*.tsx`）

| 组件         | 文件                              | 常见职责 / 已知形态        |
| ------------ | --------------------------------- | -------------------------- |
| Alert        | `components/ui/alert.tsx`         | 状态说明                   |
| AlertDialog  | `components/ui/alert-dialog.tsx`  | 确认类阻塞对话框基元       |
| Badge        | `components/ui/badge.tsx`         | 标签/状态                  |
| Button       | `components/ui/button.tsx`        | variant 与 size 控件       |
| Calendar     | `components/ui/calendar.tsx`      | 日期选择                   |
| Card         | `components/ui/card.tsx`          | 面板容器                   |
| Chart        | `components/ui/chart.tsx`         | 图表与颜色配置             |
| Combobox     | `components/ui/combobox.tsx`      | 可搜索选择                 |
| DropdownMenu | `components/ui/dropdown-menu.tsx` | 账户/操作菜单              |
| Empty        | `components/ui/empty.tsx`         | 空状态基元                 |
| Field        | `components/ui/field.tsx`         | 标签、描述、错误等字段组合 |
| Input        | `components/ui/input.tsx`         | 文本输入                   |
| InputGroup   | `components/ui/input-group.tsx`   | 输入组合                   |
| Label        | `components/ui/label.tsx`         | 表单标签                   |
| Pagination   | `components/ui/pagination.tsx`    | 分页控件                   |
| Popover      | `components/ui/popover.tsx`       | 锚点浮层                   |
| Select       | `components/ui/select.tsx`        | 选择控件                   |
| Separator    | `components/ui/separator.tsx`     | 分隔线                     |
| Sheet        | `components/ui/sheet.tsx`         | 窄屏抽屉/侧栏              |
| Skeleton     | `components/ui/skeleton.tsx`      | 占位加载                   |
| Spinner      | `components/ui/spinner.tsx`       | 小型等待反馈               |
| Switch       | `components/ui/switch.tsx`        | 布尔选项                   |
| Table        | `components/ui/table.tsx`         | 表格基元                   |
| Tabs         | `components/ui/tabs.tsx`          | 同页分区                   |
| Textarea     | `components/ui/textarea.tsx`      | 多行输入                   |
| Toggle       | `components/ui/toggle.tsx`        | 单项开关样式控制           |
| ToggleGroup  | `components/ui/toggle-group.tsx`  | 成组切换                   |
| Tooltip      | `components/ui/tooltip.tsx`       | 补充说明                   |

组件来源是 shadcn/base-nova（Base UI）；UI 规范要求优先复用已有 primitives 与 variants。没有独立通用 `Dialog` 封装文件；实际 Dialog 有 Auth dialog provider，其他浮层用 AlertDialog、Sheet、Popover、DropdownMenu 或直接 Base UI。Toast 由 Sonner Provider 提供，不在上述 28 文件内。`components/ui/empty.tsx` 存在，但用户页面也有 feature 自己的空态组合。

### 7.2 代表性高层组件（18 个模块）

本次深入追踪的 18 个模块：`AppShell`、`SiteNav`、`DesktopNav`、`MobileBottomNav`、`AccountMenu`、`ThemeModeNavButton`、`AdminShell`、`WorkCover`、`DiscoverBookCard`、`ShelfBookCard`、`ShelfContinueHero`、`HistoryWorks`、`BookDetailHero`、`ReaderChrome`、`ReaderTocSidebar`、`ReaderPart`、`AccountPage`、`AuthDialogProvider`。页面还组合 EmptyState、skeleton、Reader AI/词典/TTS 控件、表单和 Toast，详见对应小节。

**结论：** 新用户页面已有导航、布局、表单、Tab、选择、封面、反馈和加载基元可复用；当前证据不支持另建平行组件库。是否共用现有 feature 层书籍卡片需要按已存在的差异讨论，不能把“使用相同封面”误说成“已有完全相同的 Card”。

## 8. Work / Book Presentation

| 展示单元                   | 文件                                                                   | 使用位置 / 字段                                                                                      | 布局、CTA、交互                                                                                |
| -------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `WorkCover`                | `features/work-cover/work-cover.tsx`                                   | Discover、Shelf、Shelf Hero、详情、相关作品、Reader 目录、History；标题、封面图、（standard 时）tags | `standard` 有主题化占位封面/封面图；`compact` 用于小列表封面。复用的是封面，不是统一卡片结构。 |
| `DiscoverBookCard`         | `features/discover/discover-book-card.tsx`                             | Discover；封面、标题、作者/章节元信息、可能的进度                                                    | 封面和标题通详情；卡片不提供明显 Add to Shelf CTA；网格排列。                                  |
| `ShelfBookCard`            | `features/shelf/shelf-book-card.tsx`                                   | Shelf 网格；封面、标题、最多两条本地化分类标签、状态、进行中进度                                     | 点击进入详情；网格卡片、2:3 封面；没有行内移除/删除操作。                                      |
| `ShelfContinueHero`        | `features/shelf/shelf-continue-hero.tsx`                               | 当前阅读作品；封面、标题、taxonomy、进度                                                             | 主 Continue 按钮跳 `/read/:id` 并可带 part；桌面横排、移动纵向。                               |
| `HistoryWorks`             | `features/history/history-works.tsx`                                   | History 记录；封面、标题、作者、状态/最近阅读                                                        | 列表行；紧凑 Cover；按最近时间降序；整项可打开 Reader。窄屏合并状态和时间信息。                |
| Book detail hero / related | `features/book-detail/book-detail-hero.tsx`, `book-detail-related.tsx` | 详情和推荐；封面、作品 metadata                                                                      | 阅读、加入书架/已在书架状态 CTA 位于详情模式；相关作品为紧凑网格链接。                         |
| Reader TOC work header     | `features/reader/reader-toc-sidebar.tsx`                               | 目录抽屉/侧栏；封面、标题与章节                                                                      | 章节列表跳转；桌面固定侧栏、移动 Sheet。                                                       |

Discover 与 Shelf 分别实现卡片 metadata、链接和排布；共用 WorkCover，但结构与字段并未统一。History 是行列表，Continue Reading 是突出 Hero。代码证据能确认呈现重复与上下文差异，不足以判断应合并成一个卡片 API。

## 9. Shelf

- **页面标题/路由：** 页面标题由 i18n Shelf 文案提供；常见中文显示“书架”；路径为 `/my-shelf`。Nav config 继续将其语义 ID 叫 `shelf`，route 常量仍使用 shelf 路径。当前代码没有解释为什么保留这个 URL；视作既存命名/兼容现状，不推断原始动机。
- **数据：** `features/shelf/shelf-public.ts` 调用 `GET /api/shelf` 并解析 `ShelfData`。UI 按 current entry 与 `data.items` 呈现；没有在卡片上区分 Personal Work 与 Saved Catalog 的来源标签。
- **结构：**

```text
Page
├── 标题/简介
├── 有 current entry：ShelfContinueHero（继续阅读、进度）
├── items 有内容：ShelfGrid → ShelfBookCard
└── 没有内容：ShelfEmptyState → Discover CTA
```

- **布局/字段：** 当前继续阅读突出展示；其余为响应式 grid；封面、标题、taxonomy 标签、状态、进行中进度。没有顶部列表/网格切换。
- **CTA：** 继续阅读；作品卡进入详情；空状态进入 Discover。卡片当前未暴露移除/删除 CTA。
- **状态：** 有 `ShelfSkeleton`；请求失败显示错误/重试；未登录打开登录流程并保持等待态。空态含插图与 Discover CTA。
- **筛选/排序：** 页面级源码中未见自由搜索、分类筛选或排序控件；显示 API 返回顺序。
- **移动端：** AppShell 提供固定底部导航；内容区适应窄屏，Hero 堆叠，卡片网格列数少于桌面。

## 10. Discover

- **结构：** 标题、分类 chips、标签 chips、作品网格、分页/移动追加加载；query 变化重置分页。`DiscoverFilters` 当前提供分类/标签筛选，未见自由文本搜索。
- **数据：** 分类、标签与 Catalog works API；列表额外尝试从 `/api/shelf` 取得书架状态；未登录时书架查询可缺省，不妨碍目录列表。
- **卡片：** `DiscoverBookCard` 展示封面、作品标题与作者/章节信息，以及可用时的进度；封面/标题打开详情。网格断点大致为移动 2 列、md 4 列、lg 5 列。分页在桌面使用 pagination，移动以首屏/追加加载呈现。
- **Add to Shelf / Library：** 卡片源码没有独立加入按钮；书籍详情的 `BookDetailHero` 与移动 `BookDetailStickyCta` 已承载阅读/加入/书架状态操作，调用 `useAddToShelfMutation`。后续 Add to Library 可讨论沿用详情 CTA；这只是现有模式位置，不是最终交互决定。
- **状态：** Query skeleton/错误重试、无结果反馈；筛选切换时保留/覆盖列表依实现状态处理。

## 11. Reader

### 结构与阅读文字

- Reader route 用独立 Reader layout，不出现主站 Nav 或移动底栏。`ReaderChrome` 是顶部轻量工具栏；Chrome 默认隐藏，正文区域点按可切换显隐。
- `ReaderPart` 渲染净化后的阅读 HTML；正文列最大约 680px；serif 阅读字体、默认字号 md，用户可在 sm/md/lg 间切换。字体大小在当前组件状态中管理，不等于持久化偏好。
- `ReaderTocSidebar` 桌面为固定目录侧栏，移动切为 Sheet；可见作品封面/标题、章节列表、当前章节 active 状态与详情入口。
- 章节上下导航包括上一章/下一章和章节完成/状态交互。Reader 状态和 parts 查询来自 `/api/reader/*`；阅读心跳发至 `/api/reading-heartbeat`。

### 工具与窄屏行为

- Chrome 控件包括返回/目录、作品与章节上下文、字号、AI 辅助和 TTS；选中文字后弹出工具条，提供解释/提问/查词/翻译选择。
- 翻译/词典/AI 各有 feature 组件与 API；词典结果通过 Reader dictionary view 展示，Reader assistant 使用对话/assist API；TTS 支持声音角色、播放/暂停、速度和朗读高亮同步。
- 小屏面板使用 Sheet/Popover 类浮层而不是主站底部导航；主阅读列保持限宽和可读性。加载包含 Reader 专用 loading/unavailable 状态；词典/assist 有各自错误重试入口。
- 颜色仍来自全局 light/dark semantic theme；不存在 Reader 单独切换的主题系统。

**视觉基线结论：** Reader 已有独立且稳定的产品视觉语言：安静的 chrome、居中的长文阅读列、衬线正文、字号控制、章节目录、按需出现的选择辅助。Reader 正文排版、Chrome、TOC、选择工具、翻译/词典/AI/TTS 当前交互都应作为可保留现状；User-first 后续只需针对经讨论确认的数据/入口变化判断是否接 API。

## 12. History / Continue Reading

- **History：** `/reading-history` 使用 `useReadingHistoryQuery` 和 `/api/reading-history`；Summary 展示阅读统计，Heatmap 显示活动格，HistoryWorks 按最近阅读时间降序呈现作品行。行包含标题、作者、封面、状态和最近阅读日期；没有把每一行做成 Shelf card。
- **Continue Reading：** 当前明确突出在 Shelf 的 `ShelfContinueHero`，数据由 `/api/shelf` 的 current 项提供；展示进度条/比例和继续阅读 CTA。History 有完成/进行中统计和记录，但现有 history item 不呈现与 Shelf Hero 相同的 Continue CTA。
- **Progress：** Shelf 卡对进行中作品显示薄进度条；Continue Hero 提供更显著进度；History 的主要信息是状态和 last-read，不是连续阅读控制。
- **语义边界：** 目前 Shelf 同时承载 current/继续阅读与 item 集合；History 是按阅读活动/时间组织的记录。Personal vs saved catalog 的 UI 语义未明确分组。是否会把 Library、History、Continue Reading 的责任重新划分，需要人工产品决策。

## 13. Settings

- 用户 Settings route、BYOK provider form、用户级 AI/TTS 配置 UI：**Not implemented**。
- `/account` 负责个人资料、换邮箱、换密码；Theme 与语言在用户菜单；因此不能把这些位置称为已有通用 Settings 页。
- Admin Config Center 是系统管理员配置页面：AI provider/model、TTS、Dictionary 有各自的配置面板；`/admin/ai`、`/admin/tts`、`/admin/dictionary` 都跳转到中心相应 tab。
- **现有可继承模式（只记录，不提出 Provider UI）：** Account 的表单字段/提交/错误反馈模式，Admin Config 的 Tab/表单区分模式，以及共享 Field/Input/Select/Combobox/Switch/Skeleton/Tabs。用户级秘密输入、模型选择和保存反馈并无已确认的用户页面组件组合。

## 14. Account / Auth

- `/account` 在限宽页面中展示资料字段并提供改邮箱/密码表单；表单字段用 TanStack Form 与 Zod schema；请求失败有字段内错误/重试信息，成功/失败也可能通过 Sonner 提示。
- 登录/注册/忘记密码入口由 AuthDialogProvider 提供 Dialog 多模式切换；没有独立 login/register routes。独立 Auth 页面使用 AuthLayout、AuthIntro/AuthPanel 与一致的 field/form 风格。
- Avatar menu 提供账户中心、语言、主题和退出；管理员在符合角色时增加 Admin 入口。
- 表单交互可复用字段和 feedback 既有模式；BYOK 是否应位于独立 Settings 以及需要哪些字段尚未决定。

## 15. Loading / Empty / Error

| 类型         | 现有模式 / 实例                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skeleton     | `components/ui/skeleton.tsx`；Shelf、Discover、History、账户/管理页面加载占位；Admin logs 用 Suspense fallback。部分页面还有专属 skeleton 结构。                      |
| Spinner      | `components/ui/spinner.tsx` 用于局部操作等待；不是所有页面的统一全屏加载样式。                                                                                        |
| Empty        | `components/ui/empty.tsx` 基元存在；Shelf、History 等页面使用带插图、说明、CTA 的 feature empty state。Discover 无结果与 Shelf/History 无数据的视觉结构并非同一组件。 |
| Error        | 页面级 query 错误多为文案 + retry/refetch；Reader、详情、Account、Admin 子流程也有 feature 专属失败状态。                                                             |
| Inline error | Auth/Account/Admin 表单在字段附近显示校验/提交错误；API 错误可格式化后留在当前面板。                                                                                  |
| Toast        | 全局 Sonner；表单成功/失败、操作反馈会用 toast。某些流程同时显示 inline feedback。                                                                                    |
| Auth/401     | App UX 通过登录 dialog 处理需要认证的操作；页面和查询的 pending/error 细节依 feature 而异。                                                                           |

共通做法是保留当前上下文，以 skeleton/局部反馈表达等待，以页面内错误和重试恢复；空态经常有下一步 Discover CTA。实现不是单一状态机或单一 Empty component，后续新增页应先核对相邻 feature 的实际模式。

## 16. Responsive Design

断点来自 Tailwind 响应式类，主要结构边界为 `md` 与 `lg`，非每个页面都使用所有断点。

| 区域       | Desktop / Tablet / Mobile 源码表现                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Navigation | md 起显示 SiteNav 桌面主链接；窄屏主链接隐藏、AppShell 才出现固定 bottom nav；Reader/Admin/Landing 保持独立导航。 |
| Shelf      | 容器宽度增大、卡片 grid 列数增加；Continue Hero 从窄屏纵排变桌面横排；底部导航占用安全区域。                      |
| Discover   | 作品网格由窄屏 2 列扩至 md 4 列、lg 5 列；移动采用加载更多，桌面提供分页组件。                                    |
| Reader     | 工具 Chrome 与目录适应窄屏；桌面目录侧栏转为移动 Sheet；正文列有宽度上限；主站移动导航不出现。                    |
| History    | 统计桌面横排、窄屏 2×2；History list 次要字段在窄屏合并。                                                         |
| Admin      | 桌面固定侧栏；窄屏顶栏菜单打开 Sheet；管理内容自身滚动。                                                          |

事实趋势是 App 用户流程已采用“desktop top-nav + mobile bottom-nav”，而 Reader/Admin 各有导航模式。新 Library/Settings 若属于普通 App route，沿用 AppShell 是现存模式；本审查不建议重新设计导航。

## 17. Current Consistency

下列 **6 个不一致点**按可观察差异计数，不表示六个都应修复；不含布局因用途不同而合理分化的情形。

| ID  | 类型                          | 证据 / 位置                                                                       | 观察                                                                                                                                           |
| --- | ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Legacy-looking 命名           | `AUTH_ROUTES.shelf`、`/my-shelf`、nav config 的 `shelf`；用户可见标题本地化       | 路径和实现语义继续叫 Shelf；User-first 文案/产品讨论使用 Library 概念可能产生映射问题。保留旧路径是现状，不推断原因。                          |
| C2  | 重复实现                      | `discover-book-card.tsx` 与 `shelf-book-card.tsx`                                 | 都展示 WorkCover + 标题/元信息，但布局、标签、状态、进度和 CTA 分别实现；仅 Cover 共享。                                                       |
| C3  | 空态一次性组合                | `features/shelf/*empty*`、`features/history/*empty*` 与 `components/ui/empty.tsx` | 页面插图、描述、CTA 由各 feature 自行组合；基础 Empty primitive 存在但不是页面共用皮肤/模板。                                                  |
| C4  | Loading/Error 呈现分散        | Shelf/Discover/History/Reader/Account/Admin feature 状态组件                      | skeleton、inline error、整页提示、局部 spinner 与 retry 所在位置不完全统一。错误恢复逻辑依页面而异。                                           |
| C5  | 账户/偏好入口随 viewport 变化 | `SiteNav`、`AccountMenu`、`/more`、`MobileBottomNav`                              | 桌面账户直接在 avatar menu；移动账户转入 More 页面；主题/语言入口位置也随账户菜单出现。                                                        |
| C6  | 页面标题文字尺度有上下文差异  | Landing、App 标题、Account、Admin 与 Reader header 的 utility/语义样式            | 不同页面标题使用不同实际字号/容器与上下文；Reader/Admin 的上下文独立。存在设计 token 层级，但页面没有完全统一的单一 PageHeader 组件/尺寸映射。 |

### 稳定模式

- Light/Dark 的语义 tokens 与全局 Provider；serif 阅读正文、sans UI；暖色表面与少量 ember 强调。
- AppShell 桌面顶栏/移动底栏；Reader、Admin 各自拥有合理独立壳层。
- `WorkCover` 集中处理标准/紧凑封面；Shelf Continue Hero 用显著进度 CTA。
- Auth/Account/Admin 表单大多以 Field、Input、Button 等共享 primitives 与 Zod 验证为基础。

### One-off / 页面专用模式

- Reader selection toolbar、Reader TOC、AI/词典/TTS 工具条按阅读情境专用。
- History Heatmap、Summary 与 Landing 视觉段落是各自页面专用，不是待迁移的通用 UI。
- Admin Works 编辑/EPUB 导入流程属于内部目录管理。

### 非问题的结构差异

Landing、Reader 和 Admin 不显示用户 App bottom nav，来自独立 route layout；这是源码明确的不同页面角色，不计为不一致点。

## 18. Reuse Map

“可直接复用”表示已有模式可作为实现基线，不表示未来数据语义/产品行为已批准。

| Future Need             | Existing Pattern / Component                              |               Can Reuse Directly? |                Needs Small Extension? |                  Needs Product Discussion? |
| ----------------------- | --------------------------------------------------------- | --------------------------------: | ------------------------------------: | -----------------------------------------: |
| My Library              | `/my-shelf` AppShell、Shelf page/grid/empty/error/loading |          是，布局和大部分样式模式 |           视新数据是否含来源/分组状态 | 是：Library 与现有 Shelf 的定位、URL、命名 |
| Personal Work card      | `ShelfBookCard` + `WorkCover`                             |          部分；封面与基本书卡可用 |            需确认字段、状态、操作入口 |      是：与 Saved Catalog 的区分、删除语义 |
| Saved Catalog card      | Shelf/Discover card + `WorkCover`                         |        部分；封面、基础 grid 可用 |                 需接实际书架/作品数据 |                       是：统一展示还是分组 |
| Upload EPUB             | Admin `WorksEditPage`/上传流程、表单基元                  | 否；仅表单基元/上传过程事实可参考 |       需要用户侧生命周期/错误处理接入 |              是：入口、上传归属/流程与呈现 |
| Processing state        | Admin work workflow 状态、Skeleton/Spinner                |              部分；状态控件可复用 |      用户可理解的状态呈现需接入新数据 |                是：放 Library 内或独立流程 |
| Failed upload           | 现有 inline API errors、retry、Toast                      |          部分；错误反馈模式可复用 |            用户端失败和恢复动作需接入 |                     是：失败记录和重试流程 |
| Discover Add to Library | 详情的 Add-to-Shelf mutation/CTA                          |                是，已有详情页模式 |            如需卡片快速操作则需小扩展 |                   是：详情按钮还是卡片按钮 |
| Remove from Library     | 当前书架状态 CTA 与变更基础设施（以详情为主）             |                              部分 |     需提供移除操作入口/确认与更新状态 |        是：移除与 Personal Work 删除的边界 |
| Delete Personal Work    | 无用户侧对应动作；Admin 删除不能等同                      |                                否 |                 需定义新操作/确认呈现 |                 是：删除范围/语义/恢复预期 |
| Continue Reading        | `ShelfContinueHero`、进度条、Reader route                 |                  是，既有呈现完整 |          仅需适配经确认的数据字段/API |     是：新 Library 内位置及与 History 关系 |
| Settings                | AppShell + Account 表单/区块样式                          |          部分；壳层和表单模式可用 |                    需有用户级配置接线 |          是：Settings 页面结构、入口和范围 |
| Provider form           | Admin Config Center / TanStack Form / Zod / Field         |    部分；可复用控件与表单提交模式 |                 用户权限/字段绑定不同 |                是：BYOK 用户心智与配置边界 |
| Secret input            | Input/Password 表单基元                                   |                              部分 | 显隐、编辑/已保存遮罩、提交行为需接入 |             是：如何说明秘密值的使用与管理 |
| Model select            | Select/Combobox 基元；Admin provider model 选择           |                              部分 |     可搜索模型选项/服务端可用项需接入 |          是：Provider 与模型名是否直接暴露 |
| Save feedback           | inline error、成功/失败 Sonner、按钮 pending              |                  是，交互模式已有 |            接入新 mutation 和结果状态 |             是：保存何时生效、是否即时切换 |

## 19. Frontend Technical Stack

- Next.js 16.2.x App Router；页面由 `app/**/page.tsx` 与 `layout.tsx` 组合。
- React 19；TypeScript。
- Tailwind CSS v4（`@import "tailwindcss"`）；CSS variables 与 `DESIGN.md` tokens，不另设传统 Tailwind token config 为视觉 SSOT。
- UI primitives：shadcn/base-nova，基于 Base UI；`lucide-react` icons。
- Server state 与请求缓存：TanStack Query；API 经 feature API module + `lib/api-request`/相关 fetch client，Zod schema 校验。
- 表单：TanStack Form + Zod；共享认证约束从 `@gloaming/shared/auth` 使用。
- Auth UI 使用 Better Auth client；真实授权由 backend 负责，前端 session 状态是 UX 层。
- UI-only state 使用 React hooks/组件本地 state；本审查范围未确认全局 Zustand usage，不把它当服务端数据来源。
- Theme：`next-themes` class selector，light/dark/system；全局 Sonner Toast。
- Motion：CSS transition/animation 与 Motion 部分页面效果；需尊重 `prefers-reduced-motion`。
- 项目共享合同经 `@gloaming/shared/<module>` 和 `@gloaming/i18n`；不建议更换框架或复制合同。

## 20. Technical Debt Relevant to User-first

仅记录与拟议用户端迁移接触面的具体问题，不构成全仓质量审查：

1. **卡片重复**：Discover/Shelf metadata 和卡片动作分开实现；封面共享但卡片并未共享（C2）。
2. **Shelf 历史命名**：URL 和 nav 内部 ID 仍为 Shelf；新增 Library 概念需处理术语与现存路径映射（C1）。
3. **空态与请求状态形态不统一**：页面 feature 各自组合 empty/error/retry/loading（C3/C4）。
4. **Settings 缺位**：用户侧 BYOK Settings 没有承载页面；Admin 配置不能直接冒充用户配置（第 13 节）。
5. **技术词汇不可直接作为 UI 词**：前端可能消费新 API 字段，但其领域/基础设施名需要经过文案决策（第 22 节）。

这些是承接/语义风险记录，没有在本轮调整。

## 21. Product / UX Questions

以下 13 个问题需要人工讨论；本审查不作答案或暗示默认方案。

1. Library 页面面向用户应叫什么？
2. 是否继续保留 `/my-shelf`，或后续采用其他用户路由？
3. 主导航应显示 Library 还是 Shelf？
4. Personal Work 与 Saved Catalog 是统一展示还是分组？
5. Upload EPUB 是主 CTA、次级 CTA，还是独立入口？
6. 上传 processing 状态显示在 Library 内还是独立页面/流程？
7. Personal Work Delete 与 Catalog Remove from Library 如何区分？
8. Discover 的 Add to Library 出现在卡片还是 Detail？
9. Reader 返回如何处理进入来源为 Library、Discover 或 History 的情况？
10. Settings 中 AI 与 TTS 是同一页面还是不同 section？
11. 如何向普通用户解释“默认服务”与“使用自己的 API”？
12. Provider 是否直接展示技术名称？
13. AI/TTS 不可用时，Reader 如何提示用户？

## 22. User-first Frontend Readiness

### 后端/领域技术名与 UI 文案边界

| 术语                | 审查标记                 | UI 暴露情况/处理边界                                               |
| ------------------- | ------------------------ | ------------------------------------------------------------------ |
| Instance Provider   | **Internal domain term** | 服务端/系统级 provider 分类；不是已批准的用户可见文案。            |
| User Provider       | **Internal domain term** | 用户侧配置模型名；不意味着 UI 要直接显示术语。                     |
| Resolver            | **Internal domain term** | 选择/解析实现机制；不作为面向用户的功能名称。                      |
| Catalog Work        | **Internal domain term** | 目录实体概念；前端可显示作品信息，但不要直接采用模型术语作 label。 |
| Personal Work       | **Internal domain term** | 个人上传/作品实体概念；产品侧名称与用户理解需讨论。                |
| `processing_status` | **Internal domain term** | 数据字段名；前端应使用已决定的状态说明，不展示 snake_case。        |
| `published_at`      | **Internal domain term** | 数据字段名；是否以及如何显示时间由产品场景决定，不直接展示字段名。 |

### Readiness

#### Keep

- 保留 Gloaming 已有暖纸/暖夜 theme、字体、语义 token、轻量边框和层级。
- 保留 AppShell、Reader shell、Admin shell 各自的页面角色；尤其 Reader 的正文、工具栏、目录和选择辅助。
- 保留已有 Discover 与 Shelf 数据结构中可继续工作的呈现内容，直至产品决策明确要迁移其职责。

#### Reuse

- AppShell 的桌面 top-nav + mobile bottom-nav、主题机制与账户菜单。
- `WorkCover`、现有 Shelf Continue Hero/进度呈现、Book Detail 的加入书架交互。
- `components/ui` primitives、表单 Field/Input/Select/Combobox/Tabs、Skeleton、Empty、Sheet、Sonner 与 inline errors。
- Reader 已有 typography、TOC、selection menu、AI/词典/TTS 组件，依需接经确认的数据。

#### Extend

- 为新数据接线时沿用现有 API client/Query/Zod/Form 组织；适配当前数据结构与状态。
- 新 Library/Saved/Personal 状态可能需要书卡元信息或状态文本小扩展；其字段与操作需先由产品定义。
- 页面状态可在相邻 feature 的 loading/empty/error/retry 基础上接入；不预设新通用抽象。

#### Discuss

- Library 的命名、`/my-shelf` 路由、顶部/底栏 nav label 与入口层级。
- Personal Work / Saved Catalog 分组；上传、processing、失败恢复、删除/移除语义。
- Discover 快速加入位置、Reader 返回目的地、继续阅读归属。
- Settings IA、默认 AI/TTS 服务与 BYOK 文案/Provider 可见名称、不 available 状态提示。

### 页面缺失与总体结论

当前用户侧 Settings、Library 路由和 EPUB 上传页面均不存在；`/my-shelf` 是现有 Shelf 页面，Admin 上传只服务管理端作品供给。多数通用布局、展示与反馈模式已可直接复用，Reader 已形成独立稳定的视觉语言。后续 User-first 迁移应自然接入这些基线；在人工 Product / UI Gate 前，不应把新增领域术语、路由或用户流程当作已决策事实。

---

## 审查计数摘要

- 路由页面源码：26 个 `page.tsx`；其中 alias/redirect 路径不对应独立 UI。
- Layout：5 个。
- 核心组件：28 个基础 UI 源文件清点 + 18 个代表性导航/壳层/领域组件源码检查，共 46 个模块。
- 设计/token 定义文件：2 个（`DESIGN.md`、`apps/web/app/globals.css`）。
- 明确记录的不一致点：6 个。
- 待人工讨论的 Product / UX 问题：13 个。
- 真实运行界面验证：未进行。
- Runtime code 修改：No。
