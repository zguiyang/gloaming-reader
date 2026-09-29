# User / Admin Domain Boundary

> 阶段：当前 `dev-02` 的调查与架构建议。本文依据代码现状提出后续 Architecture Subtraction 候选；它不是实现批准，也不表示已经迁移或删除任何运行时能力。
>
> 基线：`dev-02`，HEAD `c174aabb5639f72cea7d5c9886084c3617a4c717`。本轮只新增本文档。

## 1. Product Boundary

Gloaming 的定位是个人阅读环境，提供公版内容发现与 AI / TTS 辅助，可选择自托管或 Hosted Instance。它不是内容平台、CMS 或多人共享书库服务器。

所有书籍、阅读、Library、进度、历史、用户标签、Personal Upload、Saved Catalog Work、Reader 与个人 AI / TTS 设置，归 User。Admin 是普通 User 加实例管理能力；只应额外管理 Users、Discovery Sources、Instance AI / TTS、Jobs、Usage / Cost、Storage、Logs / System。

本文采用本任务明确给定的产品原则作为目标边界。与之冲突的旧 prototype、MVP、Admin CMS、Catalog upload、Taxonomy 方案应标记为 Historical / Superseded，不因旧文档而继续保留。

## 2. Current State

### 已确认事实

- `ReadingWork` 是书籍根模型。`reading_work.owner_user_id`、`visibility`、`origin_kind`、`processing_status` 与 `published_at` 同时承载个人上传、Catalog 与摄取状态。
- Personal EPUB 已走认证用户入口 `POST /api/works`，由 session 取得所有者，创建 `visibility=private`、`origin_kind=user_epub` 的 Work，并调用共享 EPUB ingest / parser；不会经 Admin 上传或 publication 流程。
- Library 的 `GET /api/library` 组合用户拥有的作品与显式保存的 Catalog Works；`user_library_item` 只表示显式保存的 Catalog membership，`reading_state` 独立表示进度。
- Catalog 列表通过 `published_at` 过滤公开作品。Admin 当前仍可创建 / 上传 Catalog Work、编辑元数据、发布 / 撤回、删除、重试 workflow 与预览。
- `tag`、`category`、`source` 是共享全局维表；`reading_work_tag`、`reading_work_category`、`reading_work_source` 都按 Work 关联。它们不是用户私有组织标签，也没有 Discovery Source sync 配置语义。
- 当前没有已实现的 Project Gutenberg、Standard Ebooks、OPDS 或其他 Source Adapter / sync API。`source` 表仅以 `match_rule` 匹配 EPUB `dc:source` 元数据。
- AI / TTS 有实例配置和实例维度调用日志。AI 统计有 token 字段，但写入流程把 `costAmount` 设为 null；TTS 有次数、失败与延迟信息，没有已见的费用字段。
- Admin Storage 页面既显示统计和孤儿清理，也提供逐个 object 列表 / 详情元数据；不是纯粹的容量健康摘要。
- 没有 Admin Users 管理页面或 `/api/admin/users` 用户列表、禁用、验证重发、密码重置等管理 API。当前只见 Admin bootstrap/auth 与相关基础设施。
- 没有通用 BullMQ Jobs / Worker 管理 API 或 Admin 页面。已有 `processing_status` / workflow meta、Admin 单 Work retry、资产清理 Job 状态，以及 `/api/admin/jobs/ping` 运维探针。
- 当前 Admin Log Center 展示 AI / TTS invocation logs；未发现面向 Admin 的应用系统日志检索 API / UI。后端有结构化 logger，不等于已有 Admin System Logs 页面。
- 当前 AI 日志 API 和详情 UI 暴露 `userId`、引用 ID、选择内容片段与回复片段；TTS 日志暴露 `userId`、Work / Part 标识及 `textPreview`。这与“Admin 不读用户私人正文”的目标存在直接冲突风险。

### 判断口径

代码 / schema / route 是当前现实；本任务声明的 User-first 原则是目标边界。以下 Keep / Remove / Move to User 等是建议，不是已经接受的 schema 或迁移决策。`Not implemented` 表示当前代码检索未发现，不代表未来不需要。

## 3. User Domain

归 User 的能力：Personal Upload、Personal Work、Library、保存公版作品、Reader、`reading_state`、History、个人标签、个人 AI / TTS 设置。普通用户与 Admin 在此处是同一 User 身份与能力，不应另造“管理员书库”。

当前 Personal Upload 的所有权由认证 session 决定，不信任客户端 `ownerUserId`。用户书籍链为：

`User → POST /api/works → Personal Work → Personal Library → Reader`

实现已存在的 User 侧核心是 Personal Upload、Library、Reader、Progress / History 和个人 Provider 设置；用户私有 Tag 尚未实现。现有全局 `tag` 不能被描述为已满足个人标签需求。

## 4. Instance Admin Domain

保留实例层运维与支持职责：用户账户支持、Discovery Source 配置 / 同步状态、Instance AI / TTS 配置、队列与 Worker 健康、用量 / 成本、存储容量与健康、脱敏 Logs / System。

Admin 对书籍的运维观察应限于工作 ID、来源 / 导入批次、步骤、状态、时间、耗时、错误类别、重试次数与资源数据。默认不返回正文、片段、私人标签、Reader 状态或可恢复正文的对象地址。需要排障时优先使用经过脱敏、按需授权的诊断信息；“运维”不是内容审核权。

### 推荐收缩后的 Admin IA

- **首屏：Instance Overview**，只放 Worker / Queue 健康、近期失败摘要、AI / TTS 用量与 Provider 健康、存储用量 / 告警；不要放 Catalog Work 列表。
- **Users** 与 **Discovery Sources** 各自独立，前者是账户支持，后者是 Source 配置 / 同步状态；两者当前都未实现。
- **AI & TTS** 合并为实例 Provider 设置入口；Provider 诊断与用量在相应设置子页 / Overview 呈现，避免两个平行的 CMS 式配置总览。
- **Jobs** 独立呈现脱敏的队列与任务状态、失败和重试；当前未实现通用 Job console。
- **Storage** 只呈现容量、对象数、健康、孤儿摘要与经审计 cleanup，不提供对象浏览。
- **Logs / System** 汇总脱敏应用事件与系统健康。当前 Log Center 只有 AI / TTS 调用记录；应用系统日志检索尚未实现。
- **Usage** 当前更适合作为 Overview 和 AI / TTS 里的聚合区块；等真实 cost / quota / budget 形成独立运营任务时再评估独立页面。

## 5. Admin Capabilities That Should Be Removed

`/admin/catalog/works` 当前是一本一本管理 Catalog 内容的 CMS 工作台。建议移除其人工内容运营 UI 与对应 Admin CRUD API：

- Admin 文本建书、EPUB 上传与去重后创建 Catalog Work：删除。管理员上传应使用普通 User 的 `POST /api/works`，成为自己的 Personal Work。
- Admin 编辑书目 / 手工编辑 Tag、Category、Source：删除。Source ingestion 的标准化与校验由 Adapter / pipeline 负责；不转化为另一套人工 Admin CMS。
- 人工 Publish / Unpublish workflow：删除。导入校验通过后由 ingestion policy 控制 Discover 可见性；保留 `published_at` 的后端语义，见第 8 节。
- Admin 手工 Delete Catalog Work：从日常 UI 删除。导入去重 / 重同步 / 源下架需要系统级、可审计的 source-owned 生命周期，不能继续用通用 Admin CMS 删除按钮代替。历史数据处置需另行决策。
- 面向 Admin 的内容 Preview：从 Catalog 编辑工作台移除。摄取质量由校验和自动化检查保证；不得借此预览私人 Work。
- Admin Taxonomy UI 与全局 Tag / Category / Source 的 CRUD / cleanup API：删除。底层 ingestion 元数据映射暂留，直到 Source pipeline 接管。
- Admin 逐本内容重跑入口：从 Work 编辑页移除。未来如需操作，转为有审计上下文的 Source / Job 运维动作，不授予手工改书或审内容权限。

### `/admin/catalog/works` 能力损失判断

| 当前能力             | 移除 Admin UI 后的真实损失                                                                              | 建议                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Upload               | 失去 Admin 手工制造公版 Catalog Work 的入口；这是目标上应失去的能力。用户仍可上传自己的 Personal Work。 | Remove                                                     |
| Edit metadata        | 失去逐本人工覆写元数据；未来 Source Adapter 应映射来源字段，保留 provenance 与校验结果。                | Remove；底层解析/映射按需保留                              |
| Publish              | 失去人工按钮；`published_at` 的 Discover 发布事实仍应存在，由导入 pipeline 设置。                       | Remove UI；Keep Backend                                    |
| Unpublish            | 失去人工按钮；未来由 Source 撤下 / 同步策略更新可见性。                                                 | Remove UI；Keep Backend lifecycle                          |
| Delete               | 失去手工删除单本 Work；应改由可追溯的 Source 生命周期或专门数据处置流程。                               | Remove UI；删除 API 不自动保留为通用 Admin CRUD            |
| Preview              | 失去 Admin 内容预览工作台；不影响 User Reader。                                                         | Remove Admin UI                                            |
| ingestion monitoring | 当前无集中 Jobs / Worker 控制台，逐本页面承担部分 workflow 状态与重试展示。                             | 从内容编辑中分离为脱敏 Instance Job 运维视图；底层状态保留 |

## 6. Capabilities That Should Move to User

- 每个用户自己的 Tag 与书籍组织、过滤应迁到 User Domain；Tag 的唯一性和访问控制需按用户隔离。当前产品没有已实现的用户 Tag CRUD / UI，不能只把全局 Admin 页面改名后视为迁移完成。
- 用户上传、书籍元数据查看与自己的 Library / Reader 能力归用户。当前个人上传已就位，用户标签与必要的个人书籍管理操作仍是后续能力范围。
- Admin 账号也以同一 User API / UI 管理自己的书籍与设置；Admin 角色不扩大对他人私人 Work 的读取和修改权限。

## 7. Catalog / Discover Boundary

当前 Discover 来源为数据库中的 ownerless Catalog `ReadingWork`，读取 `/api/catalog/works`、`/api/catalog/tags`、`/api/catalog/categories`；“由外部公版来源自动导入”尚未实现。Admin 手工创建仍是当前 Catalog 的内容供应路径，和目标方向冲突。

无 Admin Upload 后，Catalog Work 由未来的 External Public-Domain Source Adapter 产生：

`Source → Sync / Import → validation-ready Catalog Work → published_at → Discover → User Save to Library`

可复用的最小现有能力是共享 EPUB 存储、去重、解析、Work / Part / ContentAsset 管道和 Catalog 只读查询。Catalog Work 仍是面向 Discover 的公版作品实体；它不代表 Admin 私人书籍，也不需要内容运营人员逐条录入。`admin_text` 按仓库边界只作内部开发 / 测试 fallback，不作为内容供应路线。

## 8. Publication Boundary

保留 `reading_work.published_at` 作为 Catalog Work 是否对 Discover 可见的发布 SSOT 是合理的：`catalog.ts` 使用它限制列表与详情可见性，Admin lifecycle 目前通过设置 / 清空该字段实现发布 / 撤回。

建议将“公开可发现”这一 Domain 语义与“Admin 点击发布”分离：Source import 完成来源验证、解析与元数据校验后，由 ingestion policy 设置 `published_at`；同步发现撤回或内容失效时按明确规则撤下。`processing_status=ready` 不应自动等于 publication；Publication 要表达有效 Catalog 记录已获准面向 Discover，而非人工编辑状态。

当前 `published_at` 字段与 Catalog 过滤保留建议为 Keep Backend / Remove UI。是否需要区分 Source 的原始发布日期、首次进入 Discover 时间、撤下 / 重新发布历史，当前实现与产品要求不足以定论，列为 Deferred；不要在本轮扩字段或改 schema。

## 9. Tag / Category / Taxonomy Boundary

- **User Tag：** 目标是用户所有、用户间隔离。当前 `tag` / `reading_work_tag` 为全局 Work 元数据维度；没有 `user_id`、用户 Tag API 或个人 Tag UI。建议后续迁移到 User-owned 结构，并区分用户组织标签与来源描述性 `subject` / `bookshelf` 元数据。
- **User Category：** V1 不保留。当前 `category` / `reading_work_category` 与 Discover `/api/catalog/categories` 是 Catalog 导航 / 筛选事实；应由 Source Metadata 映射和 Discover 产品筛选策略替代。删除前须确认 Catalog 查询、历史数据及 Discover 当前 UI 的替代字段。
- **Source Metadata：** EPUB `dc:source` 的 `source` + `reading_work_source` 是元数据匹配 / provenance，不是 Source Adapter 管理对象。未来 `subject`、`category`、`language`、`author`、`bookshelf` 属来源记录元数据，不能与 User Tag 共享 CRUD / taxonomy ownership。
- **Admin Taxonomy UI：** `/admin/taxonomy` 与 `/api/admin/taxonomy/:kind` 对三种共享维表执行 CRUD；建议全部移除。后台兼容映射可短期留存供现有 ingest 解析，但不得继续给 Admin 手工维护。
- **彻底退场候选：** Admin taxonomy CRUD、通用 Admin taxonomy picker / source edit。`category` 与 Category join 在完成 Discover 替代映射及历史清理后可退出。全局 Tag 数据应先迁移 / 归档，再删除旧表；Source 元数据表不可与 Source config 一起混删。

## 10. Jobs / Logs / Storage / Usage

### Jobs

当前有 BullMQ `content-parse`、`work-metadata-fill`、`metadata-enrich`、`part-audio-generate`、`asset-cleanup` 等后台工作，但无通用 Admin Job list / Worker health / duration / failure console。`/api/admin/jobs/ping` 只是探针；Catalog Work 单条 retry 是 CMS 入口。

真正的 Instance Operations Job 投影建议提供：`jobId`、job type、脱敏 subject / work ID、Source / import batch、queue、状态、attempt、enqueue/start/finish 时间、duration、error code / 摘要、worker heartbeat、必要的资源用量与安全重试资格。只读状态为默认；重试须幂等、限权、审计。不得返回 EPUB 正文、音频正文、完整 prompt、用户私人标签、或将用户内容作为审核材料。

### Logs / Usage / Cost

AI Admin 日志具备状态、provider/model、延迟、token、用户 ID、引用 ID、错误信息与 request/response preview；TTS 日志具备成功 / 失败次数、延迟、user / work / part ID 与 `textPreview`。两者有 Admin UI / API。AI `costAmount` 当前恒写 null、统计回传 0；TTS 当前无费用列。故 Instance 用量日志与延迟 / 失败率可保留，实际费用和预算目前未实现。

必须先关闭日志对正文片段的泄露：AI `selectionPreview` / `replyPreview`、TTS `textPreview` 可能来自用户私人内容；当前 Admin 查询是实例级而非用户自助查询。建议 Admin 日志只显示聚合用量、脱敏错误类别、provider、purpose、延迟与必要 ID；按最小必要原则缩减 user/ref 字段的访问与展示。此隐私边界应先于后续日志页面收缩执行设计。

### Storage

可保留实例总用量、对象数、容量类别、失败、孤儿统计、配额与 Provider health；对象存储扫描及安全的孤儿清理属于运维。当前 `/admin/assets` 含逐对象 key / size / status 列表与分页，这超过容量仪表盘需要；建议移除对象浏览表和大对象逐项展示，只保留聚合指标与可审计 cleanup 报告。孤儿清理底层能力可保留，但运行前须确认 manifest / 引用事实、避免删除仍被读取的对象；当前扫描报告不是 per-user quota 管理实现。

## 11. User Administration

当前 Admin 用户管理能力：**Not implemented**（没有 `/api/admin/users` route 或 Admin Users 页面）。候选范围仅是实例支持：list、role / status、disable / enable、resend verification、受控 password reset flow 与审计记录。不得提供密码读取、私人书籍读取、Tag 管理或阅读进度修改。账户资料和密码修改仍由本人在 User Account 流程处理；Admin 不应取得用户身份冒用能力。

## 12. Discovery Source Future Model

Source Adapter / 外部目录 / OPDS / Gutenberg / Standard Ebooks 同步：**Not implemented**。现有 `source` taxonomy 不是它的基础配置表，不含 adapter type、credentials、enabled、sync cursor、last sync、health、error 或权限边界。

未来最小 Admin 职责限于 Source 配置、启用状态、触发 / 查看同步状态、last sync 与 error summary；作品的 ingest、字段映射、去重和 validation 由 Source Adapter / pipeline 执行。不要建 Source Marketplace，也不要复用旧 taxonomy source 当 Adapter model。实现前应另行确定 Source 身份、可见性与同步冲突规则。

## 13. Capability Classification Matrix

| Capability                                     | Current Owner                         | Future Owner                             | Action                   | Notes                                                                 |
| ---------------------------------------------- | ------------------------------------- | ---------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Personal EPUB Upload                           | User API（`POST /api/works`）         | User                                     | Keep                     | session 决定 `owner_user_id`；共享 ingest                             |
| Admin Catalog Upload / Admin text creation     | Instance Admin                        | None                                     | Remove                   | 用户上传应进入自己的 Personal Work；`admin_text` 仅 dev/test fallback |
| Shared EPUB parser / object ingest             | Backend ingest                        | User + future Source pipeline            | Keep Backend / Remove UI | 复用处理能力，不保留 Admin 上传入口                                   |
| Library / Saved Catalog Work                   | User                                  | User                                     | Keep                     | 所有权与显式 saved membership 分开                                    |
| Reader / `reading_state` / History             | User                                  | User                                     | Keep                     | Admin 不读写个人阅读事实                                              |
| User Tag                                       | 尚未实现；现有全局 Tag                | User                                     | Move to User             | 需要 user-scoped 数据/API；当前全局维表不能冒充 User Tag              |
| Category / `reading_work_category`             | Shared Catalog Taxonomy               | Source metadata + Discover mapping       | Remove                   | 先替代筛选与迁移历史数据                                              |
| Source metadata / `reading_work_source`        | Shared Catalog Taxonomy               | Source ingest metadata                   | Keep Backend / Remove UI | 与未来 Discovery Source config 分离                                   |
| Admin Taxonomy CRUD / cleanup                  | Instance Admin                        | None                                     | Remove                   | 手工维护 Tag / Category / Source 退场                                 |
| Catalog Work read model / `/api/catalog/works` | Public Catalog                        | Source-produced Catalog                  | Keep                     | Discover 仍需查询公版 Work                                            |
| `published_at` / catalog visibility predicate  | Work domain lifecycle                 | Ingest publication policy                | Keep Backend / Remove UI | 保留可见性语义，撤销人工 workflow                                     |
| Manual publish / unpublish UI                  | Instance Admin CMS                    | None                                     | Remove                   | Source pipeline 更新可见性                                            |
| Manual metadata edit / preview / delete        | Instance Admin CMS                    | None                                     | Remove                   | 历史记录处置另行决策                                                  |
| Per-work admin retry                           | Instance Admin CMS                    | Instance Job Operations                  | Keep Backend / Remove UI | 迁移为受审计 Job 操作，避免内容编辑权                                 |
| Admin Users                                    | Not implemented                       | Instance Admin                           | Deferred                 | 需要先定义支持操作和权限审计                                          |
| Discovery Source Adapter/config                | Not implemented                       | Instance Admin config + backend adapters | Deferred                 | 仅保留未来最小职责，不复用 taxonomy `source`                          |
| Instance AI / TTS config                       | Instance Admin                        | Instance Admin                           | Keep                     | 与个人 AI / TTS 配置分域                                              |
| AI/TTS invocation metrics                      | Instance Admin; 含内容片段            | Instance Admin, minimized                | Keep                     | 先移除 preview / 降低用户可识别字段；cost 尚未实现                    |
| Generic Jobs / Worker monitoring               | 部分后台状态，无通用 Admin UI/API     | Instance Admin                           | Deferred                 | 当前只有探针、Work retry 与资产 cleanup 状态                          |
| Storage aggregate / orphan cleanup             | Instance Admin                        | Instance Admin                           | Keep                     | 以总量、失败、孤儿摘要为主，cleanup 留审计                            |
| Storage per-object browser                     | Instance Admin                        | None                                     | Remove                   | UI/API 列表 key 与对象细节应从 Admin 产品界面移除                     |
| System logs                                    | Backend logger; no Admin viewer found | Instance Admin, minimized                | Deferred                 | 目标是脱敏系统诊断；当前 Log Center 只有 AI / TTS 调用记录            |

Action 仅采用 `Keep`、`Remove`、`Move to User`、`Keep Backend / Remove UI`、`Deferred`。表中 Keep 表示目标职责保留，不表示当前代码已完整符合边界。

## 14. Route / API Impact

以下列出受未来减法影响的真实路径；本轮没有删除、改造或兼容路由。

### Frontend routes / UI

- Admin CMS：`/admin/catalog/works`、`/admin/catalog/works/new`、`/admin/catalog/works/[id]`、`/admin/catalog/works/[id]/preview`、`/admin/catalog/works/[id]/preview/part/[partId]`；实现主要在 `apps/web/features/admin/works/*`。
- Admin Taxonomy：`/admin/taxonomy` 与 `apps/web/features/admin/taxonomy/*`。
- Admin Shell / IA：`apps/web/app/admin/layout.tsx`、`apps/web/features/admin/admin-shell.tsx`；当前导航包含 Works、Assets、Config、Taxonomy、Logs。
- Admin 运维 / 设置：`/admin/assets`、`/admin/config`、`/admin/ai`、`/admin/tts`、`/admin/log-center`、`/admin/ai-logs`、`/admin/tts-logs`；`/admin/log-center` 聚合当前 AI / TTS invocation logs，不是应用系统日志查询台。
- User ownership 验证面（本轮不改）：`/library`、`/discover`、`/discover/[workId]`、`/read/[workId]`、`/reading-history`、`/settings`、`/account`。用户 Tag UI 当前未发现。

### Backend routes

- Admin Catalog CRUD / lifecycle：`/api/admin/catalog/works*`，定义在 `apps/backend/src/domains/works/routes/admin.ts`；Admin Audio 管理在 `apps/backend/src/domains/assets/routes/content-assets.ts` 的 `/api/admin/catalog/works/:workId/*`。
- Public Discover：`/api/catalog/works*`、`/api/catalog/tags`、`/api/catalog/categories`，定义在 `apps/backend/src/domains/works/routes/catalog.ts`。
- Personal Upload：`POST /api/works`，`apps/backend/src/domains/works/routes/personal.ts`。
- Admin Taxonomy：`/api/admin/taxonomy/:kind*`，`apps/backend/src/domains/taxonomy/routes/admin-taxonomy.ts`。
- Storage：`/api/admin/assets/scan`、`/api/admin/assets/scans/:scanId/objects`、cleanup 与 cleanup-job retry/status，`apps/backend/src/domains/assets/routes/asset-management.ts`。
- AI / TTS：`/api/admin/ai/invocations*`、`/api/admin/tts/invocations*` 及 `/api/admin/llm/*`、`/api/admin/tts/*`。
- Jobs：`/api/admin/jobs/ping`；没有通用 Job list / Worker health API。
- Users：没有 `/api/admin/users`。

### Services / Schema / Tests / Migrations

- Services：`apps/backend/src/domains/works/admin/*`、`catalog/*`、`personal/personal-epub-upload.ts`、`ingest/epub/work-upload.ts`、`taxonomy/service.ts`、`assets/scan/*`、`assets/cleanup/*`、`ai/invocations/log.ts`、`tts/log.ts`、`application/jobs/*`。
- Schema：`packages/db/src/schema.ts` 的 `reading_work`、`tag`、`category`、`source`、`reading_work_tag`、`reading_work_category`、`reading_work_source`、`user_library_item`、`reading_state`、`content_asset`、`ai_invocation_log`、`tts_invocation_log`。`reading_work.owner_user_id` 的 `onDelete: set null` 与 `visibility` / `origin_kind` 组合在历史数据策略中需审查，不能简单删除列。
- Existing test surface：`apps/web/features/admin/works/*spec*`、`apps/web/features/admin/taxonomy/*spec*`、`apps/web/features/admin/assets/*spec*`、`apps/web/features/library/*spec*`、`packages/shared/src/{works,taxonomy,library,assets,ai-invocations}/` 与各 Backend domain 测试。删除能力时须同步调整对应断言与权限测试；本轮未运行测试。
- Migrations：`0013_reading_content_domain.sql`、`0020_dry_taxonomy.sql`、`0026_taxonomy_ssot.sql`、`0033_taxonomy_localized_names.sql`、`0034_remove_source_localized_names.sql`、`0036_user_first_pr01_schema_foundation.sql` 等构成历史数据路径。`0026` 将 Work JSONB tags 回填到全局 `tag` / junction 表；`0036` 将每条旧 `reading_state` 回填为 `user_library_item`。旧数据已累积身份与含义，不能通过删除当前 UI 推断无需迁移。

## 15. Architecture Subtraction Candidates

### P0 — 明确违背目标边界，可优先收缩

- 删除 Admin Works 导航与手工 Catalog Upload / Edit / Publish 工作台；其行为与目标的 User Upload / Source ingestion 方向冲突。
- 删除 Admin Taxonomy 导航与通用 CRUD UI / API；不再让 Admin 手工运营 Tag / Category / Source。
- 立即将 AI `selectionPreview` / `replyPreview` 与 TTS `textPreview` 从 Admin 日志产品响应 / 详情 UI 移除或脱敏；这些可能包含私人正文片段。
- 移除 Admin Storage 逐对象列表 / 详情界面；保留聚合存储健康与孤儿清理诊断。

### P1 — 先迁 ownership / 生命周期，再动 schema 或底层 API

- User Tag：设计用户归属、User API 与 UI，再迁移现有全局 Tag 关系；确认已有 Tags 是书目元数据还是用户自建标签，不混迁。
- Category：先替换 Discover 分类筛选与客户端契约，核对历史 Catalog 数据，再迁移 / 归档并移除 `category` 与 `reading_work_category`。
- Catalog Work：admin manual delete 与 Work retry API 不能直接砍除而不确认已导入作品、引用、状态和后续 Source 生命周期；移交 ingestion / Job owner。
- 隐私与 Job Ops：用户关联日志字段最小化、通用 Job 脱敏读模型和权限审计确定后，再调整相关 API / 表达式。
- User Admin、Storage quotas、per-user usage 均尚未实现；作为独立实例支持决策，不要用新增大控制台填补所有空白。

### P2 — 后续 Source-ingestion 前置架构

- 定义最小 Discovery Source adapter config / sync / status / last-sync / error 职责；不使用旧 taxonomy `source` 代替。
- 决定 source-owned Work identity、去重 / 更新 / 撤下规则与 `published_at` 写入 policy。
- 保留共享 EPUB parse / ContentAsset pipeline、Catalog 只读 query 与 `published_at` 语义，待 Adapter 有真实消费者再移除不再需要的 Admin-only ingest wrappers。

## 16. Risks

- **Data migration：** 全局 Tag / Category / Source 与其 junction 有历史数据；用户 Tag 迁移需要映射到个人 owner 并避免把来源元数据误变用户标签。
- **Access control：** `reading_work.owner_user_id`、`visibility`、`published_at` 组合决定不同 Actor 可见范围。删除 Admin Work UI 不得弱化 Reader 的 Work Access Policy，也不得让 Admin API 读到 Personal Work。
- **Historical Catalog Works：** 当前 Catalog 内容由人工路径创建；没有 Source identity / provenance adapter，移除上传入口前需盘点作品归属、来源、重复项和失效策略。
- **Publication visibility：** `published_at` 是 Discover 可见性事实。丢掉字段或误将 `ready` 等同公开，可能让未校验 Work 暴露，或让已有 Discover Work 消失。
- **Old taxonomy data：** migration `0026` 明确回填 Work tags / Category / Source 关系；migration `0036` 把旧 `reading_state` 回填为 Library item。其历史意图不能从当前模型单独推定。
- **Logs privacy：** AI / TTS preview 会把潜在私人内容片段提供给 Admin；不仅是 UI 文案问题，也需检查 API DTO、持久化与保留周期。
- **Test coverage：** 当前 Admin CMS / taxonomy / storage 测试较多；删除 route、Schema 或 migration 前须有 catalog visibility、personal isolation、User ownership 与 migration 回归覆盖。此轮没有运行测试。
- **Source adapter 缺席：** 删除唯一的 Catalog 写入包装后，在 Adapter 实现前 Catalog 可能不再增长；这是有意的供应路径切换风险，不应通过保留 CMS 绕过目标决策。

## 17. Recommended Refactor Sequence

### Phase 1 — 内容管理 UI 退场

- **Goal：** 从 Admin Shell 移除 Works / Taxonomy CMS 导航与页面入口。
- **Delete：** Admin Catalog Upload / Edit / Publish / Preview / Taxonomy 用户界面。
- **Keep：** User Upload、Discover 只读、共享 ingest、`published_at`、底层现有数据。
- **Risk：** Admin 页面当前是唯一人工补充 Catalog 的途径；Catalog 暂停增长。
- **Validation：** 确认 User Upload → Personal Work → Library → Reader；匿名访问、普通用户和 Admin 的 Owner 隔离；Discover 只列公开 Catalog Work。

### Phase 2 — 隐私与 instance 运维投影

- **Goal：** Admin 日志与存储仅暴露运营所需最小数据。
- **Delete：** AI/TTS 正文 preview 展示、Storage per-object browser。
- **Keep：** 聚合用量、成功失败、延迟、脱敏错误、容量健康、孤儿 cleanup 审计。
- **Risk：** 删除过多诊断字段会降低排障能力；AI cost 尚未真实计算。
- **Validation：** API schema 与 UI 均无正文 preview；Admin 不可读取私人 Work / assets；cleanup 仅限经验证孤儿对象。

### Phase 3 — Tag ownership 与 Category 决策

- **Goal：** 用户 Tag 归 User，Discover Category 不再依赖 Admin taxonomy。
- **Delete：** 全局 Admin Tag / Category 编辑入口与旧查询依赖（完成迁移后）。
- **Keep：** User Library 组织 Tag；来源元数据与 Work provenance。
- **Risk：** 旧 `tag` 是共享书目标注，不一定等同用户私有标签；Category 当前影响 Discover 筛选。
- **Validation：** 多用户 Tag 隔离；旧 Discover 链接 / 筛选明确退役或映射；历史 junction 无悬空引用。

### Phase 4 — Catalog Source identity 与 publication lifecycle

- **Goal：** 为真实 Source Adapter 接管 Catalog Work 写入与可见性。
- **Delete：** 通用 Admin Catalog CRUD / 人工 publication endpoints；仅在 source lifecycle 接管后删除底层 Admin wrappers。
- **Keep：** `ReadingWork`、公开 Catalog read model、可复用 ingest/parser、`published_at` publication SSOT。
- **Risk：** source 去重、内容更新、撤下与人工改动冲突尚无决定。
- **Validation：** Import 可幂等；只有 validation-ready Work 会公开；撤下不误删 User Library / Progress 历史。

### Phase 5 — Instance Admin 收缩与补齐

- **Goal：** Admin IA 收敛到用户支持、Source、Instance AI/TTS、Jobs、Usage、Storage、Logs / System。
- **Delete：** 无实例运营价值的 CMS 页面与单本运维入口。
- **Keep：** 用户支持权限（另行决策）、Provider 设置、脱敏 Jobs、实例用量与系统健康。
- **Risk：** Users、Source Adapter、通用 Job / Worker console 当前均未实现，不能用占位 UI 冒充完成。
- **Validation：** 所有 `/api/admin/**` 仍由 `requireAdmin` 保护；敏感字段最小化；个人资源仍只能由其 Owner 访问。

---

## 审查结论

**Current reality：** Admin 仍拥有显著 Catalog CMS 与共享 Taxonomy CRUD；User Personal Upload / Library 已运行；Source Adapter、User Tags、Admin Users、通用 Job console、真实 Cost 目前未实现。

**Recommended boundary：** User owns all personal reading and organization. Admin owns instance configuration, operational health, source configuration and support. Catalog Work 继续作为 Discover 的公版作品数据，但其写入 / 发布由 Source ingestion pipeline 接管；`published_at` 作为可见性事实保留，人工 Admin Publication Workflow 删除。

**Approval boundary：** 本文不授权 Architecture Subtraction、历史数据清理、Schema / Migration 改动或新 Source Adapter 实现。后续实施前需要产品 / 数据决策确认 Category 与旧全局 Tag 数据迁移，以及 Historical Catalog Work 的来源与处置规则。
