# Gloaming 用户路径功能全景（自动化测试指导）

> **用途**：上线前功能盘点；后续编写 Playwright / 浏览器 E2E、冒烟与回归用例的 SSOT（功能范围）。  
> **视角**：普通用户（含访客、已登录读者）与管理员的真实使用路径，不是工程模块图。  
> **依据**：`docs/product/*`（产品意图）+ 当前 Web/API 实现（以代码为准）。若文档与实现冲突，以「实现现状」为准，并在「差异」节标注。  
> **配套**：测试安全与执行规程见 [`mvp-e2e-test-guide.md`](./mvp-e2e-test-guide.md)。本文描述「测什么」；彼文描述「怎么测、在哪测」。

---

## 0. 如何用本文做自动化

| 用法       | 说明                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 用例 ID    | 文中 `F-*` 为功能点 ID；`J-*` 为端到端旅程 ID；自动化用例可 1:1 映射或拆成多个断言 |
| 优先级建议 | P0 = 上线冒烟（主循环）；P1 = 核心能力回归；P2 = 设置/降级/边缘；Admin 单独套件    |
| 角色矩阵   | Guest / Signed-in / Admin — 同一表面可能因角色有不同断言                           |
| 可观测结果 | 每条功能点给出建议 Assertion（URL、可见文案、toast、按钮态、API 副作用）           |
| 环境       | 写库的自动化 → 仅 `gloaming_test`；真实 AI/TTS → 需单独授权；详见 E2E guide §1     |

**产品主循环（North star）**

```text
选择真实英文 → 打开阅读 → 遇到障碍 → 上下文帮助 / 翻译 / 听读 → 继续阅读
```

**V1 明确不做**：Practice / Review / SRS / 课程 / 游戏化 streak / 社交 feed / 配额变现 / 短文库身份。

---

## 1. 角色与全局表面

### 1.1 角色

| 角色                        | 能力概要                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Guest（未登录）**         | 可看 Landing、可浏览 Discover 列表；打开需会话的动作会弹出登录对话框。Reader 正文可读，但进度同步 / AI / 整章双语 / 章完成写库会要求登录 |
| **Signed-in（已登录读者）** | Library / Discover / History / Reader 全套；个人 EPUB；标签；Settings BYOK；Account                                                      |
| **Admin**                   | 上述 + `/admin/**`（实例配置、公开分类、发现源、资产、日志）                                                                             |

### 1.2 用户表面与路由

| 表面                | 路由                                 | 默认角色                 | 导航位置                                 |
| ------------------- | ------------------------------------ | ------------------------ | ---------------------------------------- |
| Landing             | `/`                                  | Guest                    | 营销首页；登录后 CTA 可进 Library        |
| Library（日常首页） | `/library`                           | Signed-in                | 主导航                                   |
| 个人标签管理        | `/library/tags`                      | Signed-in                | Library 侧栏 / 管理入口                  |
| Discover            | `/discover`                          | 浏览偏开放；保存需登录   | 主导航                                   |
| Source Record 详情  | `/discover/records/[sourceRecordId]` | 同上                     | 从 Discover 卡片进入                     |
| Work 详情           | `/works/[workId]`                    | Signed-in 为主           | 卡片封面/标题进入（**不**直接进 Reader） |
| Reader              | `/read/[workId]?part=`               | Guest 可读；写进度需登录 | 仅显式 Read / Continue                   |
| Reading History     | `/reading-history`                   | Signed-in                | 主导航                                   |
| Settings            | `/settings`                          | Signed-in                | 账号菜单 / More                          |
| Account             | `/account`                           | Signed-in                | 账号菜单 / More                          |
| More（移动）        | `/more`                              | Signed-in                | 底栏                                     |
| 验证邮箱            | `/verify-email?token=`               | Guest                    | 邮件链接                                 |
| 重置密码            | `/reset-password?token=`             | Guest                    | 邮件链接                                 |
| OAuth 错误          | `/auth-error`                        | Guest                    | OAuth 失败回落                           |
| Admin               | `/admin/**`                          | Admin                    | 账号菜单「管理后台」                     |

**遗留重定向**：`/discover/[workId]` → `/works/[workId]?returnTo=…`

**无独立路由**：登录/注册（全局 Auth 对话框）；Discover 分类落地页（仅 chip 过滤）。

### 1.3 导航与全局控件

| 功能                                | 可见条件                | 说明                                            |
| ----------------------------------- | ----------------------- | ----------------------------------------------- |
| 主导航 Library / Discover / History | App shell（已进入应用） | 登录后日常 IA                                   |
| 上传 EPUB                           | 已登录 App shell        | 顶栏上传按钮                                    |
| 主题 light/dark/system              | 已登录 App shell        | Landing 访客无                                  |
| UI 语言 zh-CN / en-US               | 账号菜单                | 切换后 reload + cookie                          |
| 账号菜单                            | 头像                    | Account / Settings / Admin(条件) / Sign out     |
| Auth 对话框                         | 全局                    | Sign in / Register / Forgot；可带 `reason` 文案 |

---

## 2. 端到端用户旅程（优先自动化）

### J-01 首次使用：注册 → 验证 → 发现 → 保存 → 阅读 → 求助

| 步骤 | 用户动作                                     | 期望                                                 | 建议优先级 |
| ---- | -------------------------------------------- | ---------------------------------------------------- | ---------- |
| 1    | 打开 `/`，点 Sign in                         | Auth 对话框打开                                      | P0         |
| 2    | Register：姓名 / username / email / password | 对话框进入「查收邮件」态；**不自动登录**             | P0         |
| 3    | 邮件链接 `/verify-email?token=`              | 验证成功 → 可进 `/library`                           | P0         |
| 4    | 空 Library → 去 Discover 或上传              | 空态有 Discover CTA + 上传入口                       | P0         |
| 5    | Discover：浏览 → 保存可保存条目              | Save Intent：`pending` → `ready`（或 `failed`+重试） | P0         |
| 6    | 打开 `/works/{id}` → Read                    | 进入 `/read/{id}`                                    | P0         |
| 7    | 划词 Explain / 整章双语 / Listen（若已配置） | 帮助出现且不离开阅读页；关闭后继续读                 | P0         |

### J-02 日常回流：打开 → Continue Reading → 读完离开

| 步骤 | 用户动作         | 期望                                         | 优先级 |
| ---- | ---------------- | -------------------------------------------- | ------ |
| 1    | 登录后默认落点   | `/library`（post-auth 默认）                 | P0     |
| 2    | Continue Reading | `/read/{id}?part={上次 part}` + 章内滚动恢复 | P0     |
| 3    | 换章 / 滚动      | URL `?part=` 更新；进度写入 ReadingState     | P0     |
| 4    | Back / Finish    | 回到合理来源或 Library；History 有时长/作品  | P1     |

### J-03 个人 EPUB：上传 → 处理 → 读 →（可选）自动打标签

| 步骤 | 用户动作                           | 期望                                        | 优先级 |
| ---- | ---------------------------------- | ------------------------------------------- | ------ |
| 1    | 顶栏或空 Library 上传 `.epub`      | 校验通过后 toast；Library 出现 `processing` | P0     |
| 2    | 轮询至 `ready` / `failed`          | ready 可 Read；failed 有失败态与删除等管理  | P0     |
| 3    | Settings 开启个人自动打标签 + BYOK | 仅影响**之后**成功导入；默认 OFF            | P2     |

### J-04 组织书架：标签 CRUD → 赋标 → URL 过滤

| 步骤 | 用户动作                     | 期望                                  | 优先级 |
| ---- | ---------------------------- | ------------------------------------- | ------ |
| 1    | `/library/tags` 创建/改名/删 | 删除不删书、不删进度                  | P1     |
| 2    | 书本 ⋯ → 赋标                | ready 作品可赋标；AI 标签有 badge     | P1     |
| 3    | Library `?source=&tag=`      | URL 反映 source + tag；与筛选结果一致 | P1     |

### J-05 访客降级

| 步骤 | 用户动作                    | 期望                                         | 优先级 |
| ---- | --------------------------- | -------------------------------------------- | ------ |
| 1    | Guest 打开 Discover         | 列表可见                                     | P1     |
| 2    | Guest 点保存 / 上传         | 登录对话框                                   | P0     |
| 3    | Guest 打开可读 `/read/{id}` | 正文可读；Next 完成章 / AI / 整章双语 → 登录 | P1     |

### J-06 Admin 运维冒烟（独立套件）

| 步骤 | 用户动作                            | 期望                               | 优先级 |
| ---- | ----------------------------------- | ---------------------------------- | ------ |
| 1    | 非 admin 访问 `/admin`              | Forbidden                          | P1     |
| 2    | Admin：公开分类 CRUD                | 创建/编辑/删空分类；删已分配 → 409 | P1     |
| 3    | Admin：Config AI/TTS/词典           | 保存配置；可选测连/试听/查词       | P2     |
| 4    | Admin：Discovery sync / Assets scan | 任务可排队并看到状态               | P2     |

---

## 3. 功能点清单（按业务线）

说明：`Auth` = 是否要求登录；`Assertion` = 自动化宜断言的结果。

---

### 3.1 认证与账号（Auth / Account / Landing）

| ID        | 功能点           | 路径 / 入口              | Auth   | 关键行为                      | Assertion 提示                            | Pri |
| --------- | ---------------- | ------------------------ | ------ | ----------------------------- | ----------------------------------------- | --- |
| F-AUTH-01 | Landing 浏览     | `/`                      | 否     | 品牌、故事、CTA               | 页面渲染；未登录显示 Sign in              | P0  |
| F-AUTH-02 | 打开登录对话框   | Nav / CTA / 受保护动作   | 否     | 全局 Modal                    | Dialog 可见；可切换 Sign in / Register    | P0  |
| F-AUTH-03 | 邮箱或用户名登录 | Auth Dialog              | 否     | Better Auth session cookie    | 成功 toast；跳转 `returnTo` 或 `/library` | P0  |
| F-AUTH-04 | 未验证邮箱拦截   | Sign in                  | 否     | `EMAIL_NOT_VERIFIED`          | 错误提示 + Resend verification            | P1  |
| F-AUTH-05 | 注册             | Register tab             | 否     | 不发 session                  | 「查收邮件」态                            | P0  |
| F-AUTH-06 | 重发验证邮件     | Dialog                   | 否     | —                             | Toast / 成功态                            | P1  |
| F-AUTH-07 | 验证邮箱         | `/verify-email?token=`   | 否     | token 校验                    | 成功 → Library；无效 token 错误态         | P0  |
| F-AUTH-08 | 忘记密码         | Dialog Forgot            | 否     | 发邮件                        | Sent 态                                   | P1  |
| F-AUTH-09 | 重置密码         | `/reset-password?token=` | 否     | —                             | 成功 toast + 跳转；无效 token 可再申请    | P1  |
| F-AUTH-10 | GitHub OAuth     | Dialog 按钮              | 否     | 需 env 配置                   | 配置时成功回调；失败 → `/auth-error`      | P2  |
| F-AUTH-11 | OAuth 错误页     | `/auth-error`            | 否     | 错误码文案                    | 可回 returnTo / Discover                  | P2  |
| F-AUTH-12 | 登出             | 账号菜单 / More          | 是     | `DELETE /api/auth/logout`     | 回 `/`；Nav 变 Sign in                    | P0  |
| F-AUTH-13 | 查看资料         | `/account`               | 是     | 只读：姓名/用户名/邮箱/验证态 | 字段展示                                  | P1  |
| F-AUTH-14 | 修改密码         | `/account`               | 是     | 仅 credential 账号            | 成功 toast；OAuth-only 显示不可用         | P1  |
| F-AUTH-15 | 修改邮箱         | `/account`               | 是     | 新邮箱需再验证                | Toast + 验证提示                          | P2  |
| F-AUTH-16 | 切换 UI 语言     | 账号菜单                 | 是     | zh-CN / en-US                 | reload 后文案语言变化                     | P1  |
| F-AUTH-17 | 切换主题         | App nav                  | 是     | light/dark/system             | 主题类生效                                | P2  |
| F-AUTH-18 | More 页          | `/more`                  | 软门控 | 移动入口                      | 链到 Settings / Account / 登出            | P2  |

**实现差异**：无独立 `/login` `/signup`；资料**不可**在端内改显示名/用户名/头像；无社交账号绑定/解绑 UI。

---

### 3.2 Library（书架）

| ID       | 功能点                            | 入口                   | Auth          | 关键行为                           | Assertion 提示                                          | Pri |
| -------- | --------------------------------- | ---------------------- | ------------- | ---------------------------------- | ------------------------------------------------------- | --- |
| F-LIB-01 | 打开 Library                      | `/library`             | 是（写/列表） | 日常首页                           | 未登录 → 登录；空态 / 有书态分支                        | P0  |
| F-LIB-02 | 空书架                            | 无 membership          | 是            | 上传 + Discover CTA                | **无**侧栏筛选                                          | P0  |
| F-LIB-03 | Continue Reading                  | 非空且有 `in_progress` | 是            | 取最新进行中                       | Hero 出现；进 Reader 带 `?part=`                        | P0  |
| F-LIB-04 | 筛选 source                       | 侧栏                   | 是            | `all` / `personal` / `saved`       | URL `?source=`；列表一致                                | P1  |
| F-LIB-05 | 筛选 tag                          | 侧栏                   | 是            | 单 tag                             | URL `?tag=`；非法 tag 被清掉                            | P1  |
| F-LIB-06 | 筛选阅读状态                      | chips                  | 是            | all / reading / unread / completed | 列表一致（`q/status/sort/view` 读入 URL，变更未必写回） | P1  |
| F-LIB-07 | 搜索书名/作者                     | 搜索框                 | 是            | `q`                                | 匹配子集 / 无结果文案                                   | P1  |
| F-LIB-08 | 排序                              | added / recent / title | 是            | —                                  | 顺序变化                                                | P2  |
| F-LIB-09 | 视图 grid/list                    | 切换                   | 是            | —                                  | 布局变化                                                | P2  |
| F-LIB-10 | 分页 Load more                    | browse API             | 是            | page size 24                       | `hasMore` 时追加                                        | P1  |
| F-LIB-11 | 打开 Work 详情                    | 封面/标题              | 是            | **禁止**直达 Reader                | `/works/{id}?returnTo=…` 含当前筛选                     | P0  |
| F-LIB-12 | 卡片 Read / Continue / Read again | 卡片 CTA               | 是            | 显式阅读                           | `/read/{id}` 或带 `part`                                | P0  |
| F-LIB-13 | processing / failed 态            | 个人导入               | 是            | 2s 轮询                            | 遮罩 / 失败态可见                                       | P0  |
| F-LIB-14 | 从书库移除（目录书）              | ⋯ 菜单                 | 是            | DELETE membership                  | 书消失；**进度保留**                                    | P0  |
| F-LIB-15 | 删除个人书                        | ⋯ 菜单                 | 是            | DELETE work                        | 书消失                                                  | P1  |
| F-LIB-16 | 编辑个人元数据                    | ⋯ 菜单                 | 是            | title/author/description           | Toast；卡片更新                                         | P2  |
| F-LIB-17 | 上传入口（顶栏）                  | SiteNav                | 是            | Dialog                             | 见 F-UPL-*                                              | P0  |

**领域不变量（必测）**：保存 ≠ 开始进度；移除 membership ≠ 清除 ReadingState。

---

### 3.3 个人标签（Personal Tags）

| ID       | 功能点         | 入口               | Auth | 关键行为          | Assertion 提示                             | Pri |
| -------- | -------------- | ------------------ | ---- | ----------------- | ------------------------------------------ | --- |
| F-TAG-01 | 标签管理页     | `/library/tags`    | 是   | CRUD              | 列表/空态                                  | P1  |
| F-TAG-02 | 创建标签       | 管理页 / 侧栏      | 是   | 先持久化再翻译    | 创建成功；翻译失败不阻断                   | P1  |
| F-TAG-03 | 多语言名编辑   | 管理页             | 是   | 手工编辑受保护    | 缺 locale 有标记；可 Complete translations | P1  |
| F-TAG-04 | 删除标签       | 管理页             | 是   | 只删关联          | 书与进度仍在；确认文案含 bookCount         | P1  |
| F-TAG-05 | 给书赋标/取消  | 卡片 ⋯ / Work 详情 | 是   | 仅 `ready`        | 保存后卡片标签更新；部分失败会 refresh     | P1  |
| F-TAG-06 | 创建并赋标     | 赋标对话框         | 是   | —                 | 新建后保持勾选                             | P1  |
| F-TAG-07 | AI 标签标识    | 列表/对话框        | 是   | `createdBy: ai`   | AI badge                                   | P2  |
| F-TAG-08 | 自动打标签开关 | `/settings`        | 是   | 默认 OFF；仅 BYOK | 开关可存；影响后续个人 EPUB                | P2  |
| F-TAG-09 | 按标签过滤书架 | Library            | 是   | 与 source AND     | 见 F-LIB-05                                | P1  |

**不做（断言不应期待）**：单书一键重新 AI 整理；历史书自动回填。

---

### 3.4 Discover / SourceRecord / 公共分类浏览 / Work 详情

| ID       | 功能点                         | 入口                     | Auth         | 关键行为                                    | Assertion 提示                        | Pri |
| -------- | ------------------------------ | ------------------------ | ------------ | ------------------------------------------- | ------------------------------------- | --- |
| F-DIS-01 | Discover 列表                  | `/discover`              | 浏览可匿名   | records +（无分类时）legacy catalog         | 网格/搜索/分类                        | P0  |
| F-DIS-02 | 搜索                           | 提交搜索（非即时）       | 否*          | `q`                                         | 提交后列表变；非 keystroke            | P1  |
| F-DIS-03 | 公共分类 chip                  | Discover 顶栏            | 否*          | `categoryId`；选分类时隐藏 legacy 区        | 过滤生效；>12 可更多/收起             | P1  |
| F-DIS-04 | 清除筛选                       | chip / 空态按钮          | 否*          | —                                           | 恢复默认列表                          | P2  |
| F-DIS-05 | 分页                           | records / legacy 各自    | 否*          | —                                           | 页码切换                              | P2  |
| F-DIS-06 | 打开可详情条目                 | 封面/标题                | 否*          | `detailAvailable`                           | 链到 `/works/{id}?returnTo=/discover` | P0  |
| F-DIS-07 | 打开未 materialize 条目        | 封面/标题                | 否*          | —                                           | `/discover/records/{id}`              | P0  |
| F-DIS-08 | 加入书库（SourceRecord）       | 卡片 Bookmark            | 是           | Save Intent                                 | `pending` 轮询 → `ready`/`failed`     | P0  |
| F-DIS-09 | 不可保存条目                   | `isSaveable=false`       | —            | 无 EPUB 候选                                | 按钮禁用 + 提示                       | P1  |
| F-DIS-10 | 已在书库态                     | status ready             | 是           | —                                           | In library + 去详情/书库              | P1  |
| F-DIS-11 | Save 失败重试                  | failed                   | 是           | 再 POST                                     | 可再次进入 pending                    | P1  |
| F-DIS-12 | Source Record 详情             | `/discover/records/{id}` | 否*          | 书目 + 保存条                               | returnTo Discover；相关推荐           | P1  |
| F-DIS-13 | Legacy Discover→Work 重定向    | `/discover/{workId}`     | —            | server redirect                             | 落到 `/works/{id}`                    | P1  |
| F-DIS-14 | Work 详情展示                  | `/works/{id}`            | 视策略       | cover/meta/TOC                              | 非阅读主页                            | P0  |
| F-DIS-15 | 详情 Read / Continue           | CTA                      | 是（写进度） | ReadingState 决定文案                       | `/read/{id}` 或带 part                | P0  |
| F-DIS-16 | 详情加入书库（已发布 Catalog） | CTA                      | 是           | `POST /api/library/{workId}`                | 入 Library；**不**开进度              | P0  |
| F-DIS-17 | 详情移除书库                   | 管理                     | 是           | —                                           | 出 Library；进度保留                  | P0  |
| F-DIS-18 | 详情安全返回                   | Back                     | —            | 仅允许 Library/Discover/History/同书 Reader | 非法 `returnTo` 回 Library            | P1  |
| F-DIS-19 | 详情赋标等                     | in_library + ready       | 是           | LibraryWorkManagement                       | 同 F-TAG-05                           | P1  |

\*列表浏览可匿名；保存动作必须登录。

**实现差异**：Discover 的分类/搜索**不在 URL**（刷新丢失）；产品文案「卡片一律进 `/works`」对未导入 SourceRecord **不成立**。

---

### 3.5 个人 EPUB 导入

| ID       | 功能点          | 入口              | Auth | 关键行为                | Assertion 提示                           | Pri |
| -------- | --------------- | ----------------- | ---- | ----------------------- | ---------------------------------------- | --- |
| F-UPL-01 | 打开上传 Dialog | 顶栏 / 空 Library | 是   | —                       | Dialog 可见                              | P0  |
| F-UPL-02 | 拖拽/选择文件   | Dialog            | 是   | 仅 `.epub`              | 非法格式拒绝                             | P0  |
| F-UPL-03 | 超大文件拒绝    | Dialog            | 是   | `EPUB_UPLOAD_MAX_BYTES` | 错误提示                                 | P1  |
| F-UPL-04 | 上传成功        | Upload            | 是   | `POST /api/works`       | Toast「已开始」；Library 出现 processing | P0  |
| F-UPL-05 | 导入完成可读    | 轮询              | 是   | Worker parse            | availability=ready → Read                | P0  |
| F-UPL-06 | 导入失败        | —                 | 是   | failed                  | 失败遮罩；可删除                         | P1  |

个人书**不出现在 Discover**；仅 Library / `/works` / `/read`。

---

### 3.6 Reader（阅读 / AI / 翻译 / TTS / 词典）

| ID      | 功能点             | 入口                 | Auth            | 关键行为                       | Assertion 提示                         | Pri |
| ------- | ------------------ | -------------------- | --------------- | ------------------------------ | -------------------------------------- | --- |
| F-RD-01 | 打开阅读器         | `/read/{workId}`     | 正文可 Guest    | 无 AppShell                    | 正文渲染；失败 → Unavailable+Retry     | P0  |
| F-RD-02 | 按 part 深链       | `?part=`             | —               | 优先于 state                   | URL 与章节一致                         | P0  |
| F-RD-03 | 恢复进度           | 再次进入             | 写需登录        | ReadingState + anchor ratio    | 章 + 滚动位置恢复                      | P0  |
| F-RD-04 | 显隐顶栏           | 点内容中央           | —               | —                              | Chrome 显隐                            | P2  |
| F-RD-05 | TOC 目录           | `#reader-toc-toggle` | —               | 桌面侧栏 / 移动 Sheet          | `aria-pressed`；可跳章                 | P0  |
| F-RD-06 | 字号循环           | Type 按钮            | —               | sm/md/lg                       | 正文字号变化                           | P2  |
| F-RD-07 | 上一章 / 下一章    | 页脚                 | 写 state 需登录 | Next=`complete_chapter`        | `?part=` 变化；Guest 触发登录          | P0  |
| F-RD-08 | 读完 Finish        | 最后一章             | 是              | `finish`                       | 回 `/library`                          | P1  |
| F-RD-09 | 浏览器前进后退穿章 | History              | —               | —                              | part 与音频停止协调                    | P2  |
| F-RD-10 | 划词工具条         | 选 ≥2 字符           | —               | —                              | Explain / Ask / Lookup / Translate     | P0  |
| F-RD-11 | Explain            | 工具条               | 是              | SSE assist `explain`           | 行内结果；401→登录                     | P0  |
| F-RD-12 | 划词翻译           | 工具条 Translate     | 是              | assist `meaning`               | 行内释义（非整章双语）                 | P0  |
| F-RD-13 | 自定义提问         | Ask AI               | 是              | `question`                     | 行内回答                               | P1  |
| F-RD-14 | AI 抽屉            | `#reader-ai-toggle`  | 是              | 线程按 `reading_work`          | 历史仅本书；可新对话                   | P0  |
| F-RD-15 | 继续到抽屉         | 行内入口             | 是              | 需 conversationId              | 抽屉打开并续聊                         | P2  |
| F-RD-16 | 词典 Lookup        | 工具条               | Guest 可        | dictionary API                 | Popover/Sheet；无词条空态              | P1  |
| F-RD-17 | 整章双语           | Languages            | 是              | `POST /api/translate/part` SSE | 英主中副；可关闭恢复纯英               | P0  |
| F-RD-18 | 句对聚焦           | 点句子               | —               | bilingual 模式                 | sentence highlight                     | P2  |
| F-RD-19 | Listen TTS         | Headphones           | 配置依赖        | 分段合成+预取                  | 迷你播放器；未配置 toast 且正文仍可读  | P0  |
| F-RD-20 | TTS 控件           | 播放器               | —               | 倍速 0.5–2；US/UK              | 播放/暂停/重试                         | P1  |
| F-RD-21 | 听读高亮           | 播放中               | —               | 词/句高亮                      | DOM highlight 可见                     | P1  |
| F-RD-22 | 章进度条           | 顶栏                 | —               | progressRatio                  | 宽度变化（≠ scroll anchor）            | P2  |
| F-RD-23 | 查看书详情         | TOC 底链             | —               | —                              | `/works/{id}` + returnTo 当前 read URL | P1  |
| F-RD-24 | Reader Back        | 顶栏 Back            | —               | history.back 或 Discover       | 离开阅读器                             | P1  |
| F-RD-25 | 阅读心跳           | 静默                 | 是              | heartbeat                      | History 时长增加（副作用）             | P1  |
| F-RD-26 | AI/TTS 降级        | 关配置/失败          | —               | —                              | **书仍可打开阅读**                     | P0  |

**注意**：章内滚动位置**不在 URL hash**；仅 `?part=` + 服务端 `ReadingState.anchor`。

---

### 3.7 Reading History

| ID       | 功能点   | 入口               | Auth | 关键行为                | Assertion 提示                   | Pri |
| -------- | -------- | ------------------ | ---- | ----------------------- | -------------------------------- | --- |
| F-HIS-01 | 打开历史 | `/reading-history` | 是   | —                       | 未登录 → 登录 reason=history     | P1  |
| F-HIS-02 | 空历史   | 无数据             | 是   | —                       | 空态 + Discover CTA              | P1  |
| F-HIS-03 | 画像统计 | 有数据             | 是   | 天数/连续/完成数/查词数 | 数字 > 0（读后）                 | P1  |
| F-HIS-04 | 热力图   | ~365 天            | 是   | Asia/Shanghai 日界      | 有 engaged 的格子                | P2  |
| F-HIS-05 | 作品列表 | —                  | 是   | Continue / Read again   | 进 Reader；封面进详情带 returnTo | P1  |
| F-HIS-06 | 排序     | date/title         | 是   | —                       | 顺序变化                         | P2  |

---

### 3.8 Settings（读者设置 / BYOK）

| ID       | 功能点                  | 入口                      | Auth | 关键行为          | Assertion 提示           | Pri |
| -------- | ----------------------- | ------------------------- | ---- | ----------------- | ------------------------ | --- |
| F-SET-01 | 打开设置                | `/settings`               | 是   | —                 | 401 → 登录提示           | P1  |
| F-SET-02 | TTS：默认 vs 自有 Azure | TTS 区                    | 是   | region/key/voices | 保存 toast               | P1  |
| F-SET-03 | AI：平台 vs 自有        | AI 开关                   | 是   | —                 | 模式切换可存             | P1  |
| F-SET-04 | 自有 LLM Provider CRUD  | Advanced                  | 是   | BYOK              | 增删改；部分族标注未上线 | P1  |
| F-SET-05 | 模型绑定                | assist/translate/metadata | 是   | —                 | 用途可选模型             | P1  |
| F-SET-06 | 测试连接                | Provider                  | 是   | —                 | latency status / alert   | P2  |
| F-SET-07 | 个人自动打标签          | 开关                      | 是   | 见 F-TAG-08       | 失败码映射文案           | P2  |

**隔离**：用户 Settings **不得**改写实例级 Admin provider。

---

### 3.9 Admin（运维；独立套件）

| ID       | 功能点            | 路由                       | 关键行为                                | Assertion 提示                           | Pri |
| -------- | ----------------- | -------------------------- | --------------------------------------- | ---------------------------------------- | --- |
| F-ADM-01 | 入口与鉴权        | `/admin` → assets          | 非 admin Forbidden；无 session 登录提示 | P1                                       |
| F-ADM-02 | 资产扫描/清理     | `/admin/assets`            | Scan / 清孤儿 job                       | 状态流转                                 | P2  |
| F-ADM-03 | 发现源同步        | `/admin/discovery-sources` | 启停 / 同步 / 强制全量                  | run 状态                                 | P2  |
| F-ADM-04 | 公开分类 CRUD     | `/admin/public-categories` | 建/改标签/删                            | 删已分配 409；未分配成功                 | P1  |
| F-ADM-05 | Shelf 映射与整理  | 同上                       | shelf 勾选；organize                    | 映射可存；提案列表（接受动作可能仅 API） | P2  |
| F-ADM-06 | 实例 AI 配置      | `/admin/config?tab=ai`     | Provider/模型/用途                      | 保存；测连；余额                         | P2  |
| F-ADM-07 | 实例 TTS 配置     | `?tab=tts`                 | 密钥/音色                               | 保存；试听                               | P2  |
| F-ADM-08 | 实例词典配置      | `?tab=dictionary`          | Youdao/Free 等                          | 保存；查词测试                           | P2  |
| F-ADM-09 | 调用日志          | `/admin/log-center`        | AI/TTS 日志                             | 筛选分页；详情                           | P2  |
| F-ADM-10 | Legacy 路由重定向 | `/admin/ai` 等             | → config / log-center                   | 正确 tab                                 | P2  |

**Admin 不做**：Catalog 内容创作 CMS、课程编辑。（产品：ops only。）

**已知未挂 UI（勿当页面用例）**：SourceRecord↔分类 assign 面板；source-category-mappings 全流程；jobs ping / reading-history backfill 仅 API。

---

## 4. 访客 vs 登录 能力矩阵（速查）

| 能力                             | Guest                      | Signed-in |
| -------------------------------- | -------------------------- | --------- |
| Landing / Discover 浏览          | ✓                          | ✓         |
| 保存到 Library / 上传 EPUB       | 登录墙                     | ✓         |
| 打开 `/read` 正文                | ✓（策略允许时）            | ✓         |
| ReadingState / Continue / Finish | 登录墙                     | ✓         |
| 划词词典 Lookup                  | ✓                          | ✓         |
| AI Assist / 整章双语             | 登录墙                     | ✓         |
| TTS                              | 视实例配置；会话策略同实现 | ✓         |
| History / Tags / Settings        | 登录墙                     | ✓         |

---

## 5. 领域不变量（回归必测）

1. **内容模型**是 `ReadingWork` + `ReadingPart`，不是 legacy Article。
2. **Library** = 个人拥有 ∪ 显式 `UserLibraryItem`；Discover 浏览 ≠ 入架。
3. **保存不产生进度**；**移除 membership 不清除进度**。
4. **卡片封面/标题 → Work 详情**；**只有显式 Read/Continue → Reader**。
5. **阅读 AI / 翻译 / TTS 留在 Reader 内**，不成「聊天首页」。
6. **英文是默认阅读语言**；双语是叠加，不是替换。
7. **AI/TTS 关闭或失败时，书仍可打开阅读**。
8. **个人标签删除**只删标签与关联，不删书。
9. **SourceRecord** 是书目；未 materialize 前不可当可读 Work。
10. **无 Practice / Review** 表面与导航。

---

## 6. 建议自动化套件切分

| 套件                  | 覆盖旅程 / ID                                                                             | 环境                                 |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| **Smoke P0**          | J-01（可 seed 已验证用户缩短）、J-02、F-LIB-03/11/12、F-DIS-08、F-RD-01/05/07/11/17/19/26 | test DB；AI/TTS mock                 |
| **Auth**              | F-AUTH-*                                                                                  | test DB + 邮件 token 注入或测试 hook |
| **Library & Tags**    | F-LIB-_、F-TAG-_、J-04                                                                    | test DB                              |
| **Discover & Import** | F-DIS-_、F-UPL-_、J-03                                                                    | test DB + worker（导入）             |
| **Reader deep**       | F-RD-*                                                                                    | test DB；AI/TTS mock；可选真实授权跑 |
| **History**           | F-HIS-*（依赖先产生 heartbeat）                                                           | test DB                              |
| **Settings BYOK**     | F-SET-*                                                                                   | test DB；勿碰实例密钥                |
| **Admin**             | J-06、F-ADM-*                                                                             | test DB；admin fixture 用户          |

与现有规程模块对应：E2E guide §4.1←Tags；§4.2←Admin categories；§4.3←Upload；§4.4←Reader progress；§4.5←Auth/Settings；§4.6←AI/TTS/Worker。

---

## 7. 产品文档 vs 实现差异（写用例时注意）

| 主题                    | 注意                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| 登录形态                | 产品说 Sign in 页；实现是 **全局 Dialog** + 邮件落地页           |
| Discover 打开条目       | 未导入 SR → `/discover/records/...`，不是一律 `/works`           |
| Library URL 筛选        | **`source`+`tag` 持久化**；`q/status/sort/view` 读入但不一定写回 |
| Discover 筛选           | **不在 URL**                                                     |
| 词典                    | MVP 表未单列，但 **已实现**                                      |
| 个人资料编辑            | 产品常见「Account」；**姓名/用户名不可改**                       |
| GitHub                  | 按钮常显；**无凭证则不可用**                                     |
| Admin SourceRecord 分配 | API 有，**主页面未挂**                                           |
| Reader 锚点             | **无 hash**；靠服务端 anchor                                     |
| TTS User 路径           | Roadmap：懒加载分段 TTS 已实现；真实 Azure 页验收可能仍 pending  |

---

## 8. 明确不在 V1 / 不应出现的用户路径

- Practice、Review、SRS、课程、课时、打卡 streak、XP
- 以 Chat 为首页的陪伴
- 公开社交动态
- 短文库 / Article 列表身份
- 用户侧公共分类 CRUD（仅 Admin）
- 配额付费墙（V1）

若 UI 出现以上入口，应记为 **产品回归缺陷**，不是漏测「应支持功能」。

---

## 9. 文档维护

| 变更类型             | 更新本文                      |
| -------------------- | ----------------------------- |
| 新用户可见路由或 CTA | §1 + 对应 §3 + 必要时新 J-*   |
| 领域不变量变化       | §5（需产品授权）              |
| 仅后端重构无用户感知 | 可不改；改 Assertion 路径即可 |
| Admin 接线未挂 UI    | §3.9「未挂 UI」               |

**调研来源（2026-11-09）**：`docs/product/mvp-scope.md`、`prototype-flows.md`、`personal-tags.md`、`roadmap.md`；实现盘点覆盖 `apps/web/app/**`、`apps/web/features/{auth,library,discover,book-detail,reader,history,settings,account,admin}` 及对应 backend domains。

---

## 10. 快速索引：路由 → 功能 ID

| 路由                     | 主要功能 ID                   |
| ------------------------ | ----------------------------- |
| `/`                      | F-AUTH-01                     |
| Auth Dialog              | F-AUTH-02…06,10               |
| `/verify-email`          | F-AUTH-07                     |
| `/reset-password`        | F-AUTH-09                     |
| `/auth-error`            | F-AUTH-11                     |
| `/library`               | F-LIB-_、F-UPL-_、F-TAG-05/09 |
| `/library/tags`          | F-TAG-01…04,07                |
| `/discover`              | F-DIS-01…11,13                |
| `/discover/records/[id]` | F-DIS-12                      |
| `/works/[id]`            | F-DIS-14…19                   |
| `/read/[id]`             | F-RD-*                        |
| `/reading-history`       | F-HIS-*                       |
| `/settings`              | F-SET-*、F-TAG-08             |
| `/account`               | F-AUTH-13…15                  |
| `/more`                  | F-AUTH-18                     |
| `/admin/**`              | F-ADM-*                       |
