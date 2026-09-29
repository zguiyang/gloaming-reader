# PR-07 — User-first Library Frontend / Personal Upload / Read Flow

## 1. Metadata

| 字段                  | 值                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage                 | PR-07                                                                                                                                         |
| Branch                | `codex/user-first-pr07-library-frontend`                                                                                                      |
| Worktree              | `~/.codex/worktrees/user-first-pr07-library-frontend/gloaming-reader`                                                                         |
| Base Commit           | `bd0878ecdad664e406d7dd623915b9d7e44166cf`（PR-06 review 后的前端审计文档检查点；PR-06 review 为 `da5ede8b83673ec981459fea0091d8d9f5cdb279`） |
| Implementation Commit | `af20840164a1f6ed315f1ea017375d36e19ff2d3`                                                                                                    |
| Review Commit         | 本文件所在提交；SHA 见 Git 历史                                                                                                               |
| Primary Domain        | User-first Library Frontend                                                                                                                   |
| Human Review          | Pending                                                                                                                                       |

## 2. Why PR-07 Exists

PR-04 与 PR-05 已建立 Catalog、Library 后端和共享契约；PR-06 已完成 Provider 解析器。前端仍使用 `/my-shelf`，未接入 Personal EPUB 上传，也未将 Library 中的 Work 统一直接送入 Reader。本阶段把现有后端能力接入用户的书库路径，并删除旧 Shelf 页面入口。

## 3. Product Decisions Implemented

- 用户名称统一为「书库 / Library」；旧 `/my-shelf` 页面不保留重定向或兼容别名。
- Library 合并展示个人拥有的 Work 和已保存的 Catalog Work，统一栏目为「我的书」，不按来源分区或常驻显示来源徽标。
- 上传仅支持 EPUB，调用既有 `POST /api/works`。
- 书库中 ready 的 Work 点击封面或标题直接进入 `/read/:workId`；Discover 仍然进入详情页。
- Catalog Work 的管理动作是「移出书库」，仅删除成员关系。当前没有安全且保留用户预期的 Personal Work 删除能力，因此不展示删除按钮，列入 Backend / Product Follow-up。
- Library 聚合响应保留 `current` 与 `items`；Library membership、progress、history 不混为一谈。

## 4. Before

- 用户入口为 `/my-shelf`，导航、登录默认返回和 Reader 完成阅读后的路径均沿用 Shelf 名称。
- Library 返回项没有可供前端区分处理中、失败、可读的产品状态。
- 个人 EPUB 上传 API 已存在，但没有 Library 页面上传入口；Personal Work 缺少直达 Reader 的前端流程。
- 已保存的 Catalog Work 可以移除；Personal Work 删除没有学习者 API。

## 5. After

- 正式页面为 `/library`；桌面顺序为「发现 → 书库 → 历史」，移动底栏为「书库 → 发现 → 历史 → 更多」。
- 页面保留标题、Continue Reading、统一的「我的书」网格。用户通过顶部按钮选择 EPUB。
- 后端共享 Library item 新增最小化的 `availability`（`processing` / `ready` / `failed`）与 `canRemoveFromLibrary`，前端只呈现用户可理解的状态。
- 上传后刷新 Library；处理中条目轮询，ready 后可直接阅读。失败状态不伪造重试操作。
- 可移除的 Catalog 项目仅在低干扰菜单中提供「移出书库」，确认后调用 DELETE membership API。

## 6. Design Rationale

保留原 Library 页面骨架和 Continue Reading 顶部位置，沿用 Gloaming 的纸感配色、排版、留白与现有书封面网格。上传入口放在标题右侧；窄屏继续使用紧凑标题行和既有 AppShell/底部导航。处理与失败状态放在书目自身，不叠加上传仪表盘或状态面板。管理入口仅在可移除的 Catalog 项目上出现，避免把阅读主行为改成一排按钮。

## 7. Reused Existing Design Patterns

- `AppShell`、现有 desktop navigation 与 `MobileBottomNav`
- `Button`、`DropdownMenu`、`AlertDialog`、`Spinner`、现有 Toast
- `WorkCover`、现有 Library grid、Continue Reading hero、Empty、Skeleton 与错误状态
- 既有语义色、字体、断点、focus-visible 样式与 Safe Area 导航处理

## 8. New UI Introduced

没有新增设计系统或通用组件。页面新增的交互只有 EPUB 文件选择/上传反馈、最小处理/失败标签，以及 Catalog 项目的菜单与移除确认对话框。没有 Personal 删除 UI。

## 9. Route Changes

- 新正式路由：`/library`，文件 `apps/web/app/(app)/library/page.tsx`。
- 已删除 `apps/web/app/(app)/my-shelf/page.tsx`；没有 redirect、alias 或 wrapper。
- `AUTH_ROUTES`、鉴权 matcher、登录默认返回及 Reader 完成路径均指向 `/library`。

## 10. Navigation Changes

导航 ID、文案键及移动图标键从 shelf 改为 library。桌面和移动的既有顺序保持产品要求；Discover、History、More 的结构没有重构。路由匹配继续使用既有精确路径及子路径规则。

## 11. API Consumers

| 行为                          | API                                                                                                                | 消费方                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 读取书库与 Continue Reading   | `GET /api/library`                                                                                                 | `features/library/library-public.ts` / `useLibraryQuery` |
| Discover 保存到书库           | `POST /api/library/:workId`                                                                                        | 既有 Book Detail action                                  |
| 从书库移除 Catalog membership | `DELETE /api/library/:workId`                                                                                      | `removeFromLibrary`                                      |
| 上传个人 EPUB                 | `POST /api/works`                                                                                                  | `uploadPersonalEpub`                                     |
| Reader 内容/状态              | `GET /api/reader/works/:workId/parts`、`GET /api/reader/parts/:partId`、`GET/POST /api/reader/works/:workId/state` | 既有 Reader clients                                      |

本阶段没有新增 HTTP endpoint，也没有拆分 `GET /api/library`。

## 12. Personal Upload Flow

文件选择仅接受 `.epub`，并在客户端按共享的 50 MiB 上限验证。通过后以 multipart `file` 调用 `POST /api/works`。成功时显示简短确认并失效 Library query；Library hook 在存在 processing item 时每 2 秒轮询。上传失败使用现有 Toast 错误模式。未加入向导、元数据编辑、发布、AI 生成或 TTS 步骤。

## 13. Personal Work Read Flow

ready 的个人 Work 卡片封面和标题均链接到 `/read/:workId`，不进入 Catalog-only Book Detail。后端 parse workflow 对 `user_epub` 在 parse 完成后写入 `ready`，不等待 metadata、TTS 或音频生成。Reader 继续按通用 Work reader 权限读取内容。

## 14. Catalog Library Flow

Discover 页面与 Book Detail 行为保留：发现列表/详情、保存状态与加入书库 action 不变。保存的 Catalog Work 出现在统一网格，点击封面或标题直接进入 Reader；不从 Library 反向进入 Discover detail。

## 15. Remove / Delete Semantics

Catalog 项通过菜单发起「移出书库」，确认说明只移除书库关系，阅读进度和历史保留；调用 `DELETE /api/library/:workId` 并刷新 Library。Personal 删除能力没有实现：现有通用 `deleteWork` 命令会拒绝非 Catalog Work，而扩大为个人删除会涉及所有权、级联删除、内容资产清理和 progress/history 后果。因此不暴露不能执行的按钮，记录为 Backend / Product Follow-up。

## 16. Processing / Failure States

Library API 将后端 `ready` 映射为 ready、`failed` 映射为 failed、其他状态归并为 processing。UI 文案为「正在处理」和「这本书处理失败」，不暴露 `uploaded`、`parsed`、`metadata` 等枚举。处理中和失败项不可点入 Reader。没有 Retry API，所以没有重试控件。

## 17. Responsive Behavior

沿用既有断点和网格，窄屏保留标题与上传控件同一行并使用紧凑字号/间距。管理触点为 44×44 px；弹出菜单与 AlertDialog 使用现有 primitives。移动导航、安全区和 AppShell 未更换。未引入 dashboard、bento 或卡片中的卡片。

## 18. Accessibility

- 上传使用有可见名称的按钮和原生隐藏文件输入；输入标注 EPUB MIME/扩展名。
- 书封面与标题是独立的 Reader 链接，使用现有 focus-visible 样式及屏幕阅读器名称。
- 处理中/失败项不是伪装成链接的不可用控件；进度条带 `role=progressbar` 与数值/名称。
- 菜单按钮有包含书名的可访问名称；移除使用 AlertDialog 且 pending 时禁用操作。
- 移动菜单目标至少 44×44 px。

## 19. Tests & Verification

| 检查                                   | 结果                        |
| -------------------------------------- | --------------------------- |
| Web 定向测试：7 个文件                 | 64 passed                   |
| Shared Library contract 测试           | 3 passed                    |
| Backend Library functional 测试        | 3 passed（`gloaming_test`） |
| Web typecheck                          | Passed                      |
| Shared typecheck                       | Passed                      |
| Backend typecheck                      | Passed                      |
| 变更文件 ESLint                        | Passed                      |
| Prettier                               | Passed                      |
| `git diff --check`                     | Passed                      |
| Full Web / Backend / Repository suites | Not Run                     |
| E2E                                    | Not Run                     |

Backend functional test 使用现有测试数据库，并在测试进程内 mock 邮件发送；没有修改本地持久配置或生产数据。

GitNexus `detect_changes` 报告 `critical` 风险级别，涉及 30 个变更文件和多个已变更流程；导航、鉴权跳转、Reader 与 Library 调用点已结合源码和定向测试人工核对。图检查发现 1 个既有循环依赖组件（32 条枚举环），涉及文件均未由 PR-07 修改，需另行治理。

## 20. Legacy Audit

活跃 Web/shared/backend runtime 中：`/my-shelf` route、`/api/shelf`、`ShelfData`、`features/shelf`、`ShelfBookCard`、`ShelfContinueHero`、Shelf 导航键和用户可见「Shelf/书架」文案均为 0。旧路由字符串仅留在验证其不存在的测试中。`shelf_profile`、`shelfWorks` 等仅用于推荐算法内部特征/注释，与旧用户 Library API 或导航无关，不作为本次用户可见 Shelf 遗留。

历史 frontend audit 与 PR-01～PR-06 review 文档保留当时的状态记录；本报告和 README 索引记录 PR-07 后的事实。

## 21. Anti-AI Design Audit

- Dashboard-like layout：No。页面仍是阅读书库。
- Bento layout：No。保留原书籍网格。
- Card stacking / nested cards：No。书目卡片直接处于页面网格，没有包裹网格的装饰卡片。
- List-row overuse：No。书目仍以封面网格展示。
- Unnecessary helper copy：No。没有新增 subtitle 或说明段落。
- Excessive badges/status UI：No。没有来源 badge；只有处理中/失败的必要文字状态。
- New visual language：No。继续使用 DESIGN.md 与 globals.css 的既有体系。

## 22. AI-made Decisions

- 沿用现有页面结构、网格、WorkCover 和 Gloaming 视觉 token，不创建平行组件系统。
- 将来源差异限制在次级 Catalog 管理菜单能力；API 用 `canRemoveFromLibrary` 表达该操作能力。
- 将多个非 ready 后端状态压成单一「正在处理」，避免把工作流内部状态泄露给用户。
- 确认 Personal 删除涉及超出本 PR 的数据/存储策略，不增加按钮或后端删除语义。

以上是按用户已批准的产品决策执行的实现选择，没有新增页面或产品功能决策。

## 23. Scope Audit

Settings、BYOK/Provider UI、Reader redesign、Discover redesign 与 Lazy TTS 均未开始。Discover 只保留现有保存状态、API 和详情行为。没有 schema migration 或依赖变更。

## 24. Remaining Gaps

- Personal Work 删除需要先确定 owner 校验、对象存储清理、级联与 progress/history 保留策略，并实现真实后端能力后再考虑 UI。
- Full Web / Backend / Repository suites 与 E2E 尚未运行。
- 真实运行界面的视觉验收延期；人工视觉验收仍 Pending，见下方 Deferred Visual Acceptance。

## Deferred Visual Acceptance

### 当前状态

| 验收层级                        | 状态      |
| ------------------------------- | --------- |
| Implementation                  | Completed |
| Static Design Review            | Completed |
| Automated Targeted Verification | Completed |
| Runtime Visual Verification     | Deferred  |
| Human Visual Acceptance         | Pending   |

当前状态不代表 UI Approved、Visual QA Passed 或 Design Accepted。源码设计审查和自动化定向验证不能替代真实运行界面的验收。

### 延期原因

PR-07 当前位于独立 worktree / feature branch 中。该环境主要用于代码实施和定向验证，完整运行所需配置、服务、数据和统一开发环境并不完整。为了仅做视觉检查而补建一套临时运行环境会增加无意义的配置工作和环境漂移风险，因此将真实运行视觉验收延期到 User-first 各阶段合并后的统一 Integration Branch。

这项延期不是由页面问题或测试失败导致。

### 后续 Visual Acceptance Gate

在 User-first 各阶段完成并合并到统一 Integration Branch，且完整应用运行环境可用后，必须执行 **PR-07 Visual Acceptance Gate**。该门禁属于 **Final Frontend Acceptance**；unit/component tests、typecheck、lint、source review 和 AI design audit 均不能替代它。

### Visual Acceptance Checklist

#### Desktop — Library Normal State

- [ ] 页面第一眼是否仍然是「书」
- [ ] Upload EPUB 是否抢夺过多视觉注意力
- [ ] Continue Reading 与书籍网格层级是否自然
- [ ] Header 节奏是否符合现有 Gloaming
- [ ] 书籍网格密度是否合理
- [ ] 是否出现 Dashboard 感

#### Mobile — Library Normal State

- [ ] 是否真正适配小屏，而非仅把 Desktop 改为纵向堆叠
- [ ] Upload 入口是否自然
- [ ] Continue Reading 是否过重
- [ ] Grid 是否合理
- [ ] MobileBottomNav 是否正常
- [ ] Safe Area 是否正常

#### Empty Library

- [ ] 是否保持安静、简洁
- [ ] 是否出现 AI Landing Page 感
- [ ] 上传 EPUB 与发现书籍两个入口的层级是否合理
- [ ] 是否存在多余说明文案

#### Upload Pending / Processing

- [ ] 处理中状态是否自然存在于 Library
- [ ] 是否过于像后台任务管理
- [ ] 状态文案是否简洁
- [ ] 是否出现不必要 Card / Badge / Panel
- [ ] 是否影响正常阅读内容浏览

#### Upload Failed

- [ ] 失败状态是否明确
- [ ] 失败状态是否过重
- [ ] 是否误导用户认为存在不可用的 Retry
- [ ] 恢复动作是否真实

#### Saved Catalog Management

- [ ] Overflow menu 是否低干扰
- [ ] 「移出书库」是否容易理解
- [ ] 管理入口是否与普通阅读点击冲突
- [ ] 确认交互是否过度

#### Personal Work

- [ ] 个人上传作品与 Catalog 在正常浏览时是否自然统一
- [ ] 是否没有多余来源 Badge
- [ ] 点击是否自然进入 Reader
- [ ] 缺少 Delete 操作是否不会形成错误暗示

#### Dark Mode

- [ ] Upload、Processing、Failed、Dropdown、Dialog 是否沿用现有暖夜主题
- [ ] Library grid 与 Continue Reading 是否沿用现有暖夜主题
- [ ] 是否存在 hardcoded light background
- [ ] 是否存在错误对比度、意外边框或新视觉风格

#### Reader Entry

- [ ] 从 Personal Work 进入 Reader 是否自然
- [ ] 从 Saved Catalog Work 进入 Reader 是否自然
- [ ] 从 Continue Reading 进入 Reader 是否自然
- [ ] Reader 本身视觉是否未被 PR-07 破坏
- [ ] 返回路径是否合理

#### Anti-AI UI Runtime Audit

必须基于真实运行界面重新检查：

- [ ] Dashboard-like layout
- [ ] Bento layout
- [ ] Card stacking
- [ ] Nested cards
- [ ] Icon-list overuse
- [ ] Badge overuse
- [ ] Helper-copy overuse
- [ ] Decorative UI overuse
- [ ] Spacing inconsistency
- [ ] Visual hierarchy problems
- [ ] Desktop-to-mobile stacking

### 验收原则

> PR-07 的源码设计审查已经完成，但源码符合规范不等于真实运行界面已经达到最终设计质量。

真实视觉验收必须确认：

> 页面像原 Gloaming 的设计者自然继续完成，而不是像 AI 后补的一块新功能。

> 第一眼看到书，第二眼看到继续阅读，需要时才看到上传和管理。

## 25. Final State

PR-07 在 `/library` 提供合并书库、EPUB 上传、处理状态、Continue Reading 和直接 Reader 入口；Catalog membership 可安全移除。Library membership、reading progress、reading history 继续分离。Code implementation、static design audit 和 automated targeted verification 已完成；runtime visual verification 延期，human visual acceptance Pending。实现提交与审查文档提交均为本地提交，未推送或合并。
