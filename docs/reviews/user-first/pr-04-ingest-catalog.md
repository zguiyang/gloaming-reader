# PR-04 — 统一摄取与 Catalog

状态：已实现
实现提交：d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04
基线提交：dac344508f8f10faa38aed1721e8bab49a3572c3
分支：codex/user-first-pr04-ingest-catalog
主要领域：EPUB 摄取、Personal Work 归属、Catalog 操作
实现范围：共享 EPUB 持久化/解析入口，分离 Personal 与 Admin Catalog 策略
评审类型：架构审计 / 维护者交接（Architecture Audit / Maintainer Handoff）
人工评审：待完成

## 1. 本阶段为何存在

既有 EPUB 流水线面向 Admin。Personal 上传需要相同解析/存储机制，但归属、可见性、认证、生命周期与列表规则不同。Admin Work 命名亦掩盖 Admin 表面管理的是官方 Catalog。PR-04 引入 Personal 上传边界并使 Admin Catalog 操作显式化。

## 2. 之前

- Admin EPUB 摄取拥有上传、持久化与队列准备。
- 不存在学习者认证上传路由。
- Admin work/API 页面使用 `/admin/works` 与 `/api/admin/works`。
- Work-audio Admin 路径使用 `/api/admin/works` 与 `/api/admin/parts`。
- 忙碌/TTS 筛选在 Web 中推断或后过滤。
- Personal Work 归属与仅 Catalog 查询规则非独立运行时能力。

## 3. 之后

- `ingest/epub/work-upload.ts` 拥有共享 EPUB 上传规格、文件名清理、源存储/复用、Work/资源持久化与解析入队隔离。
- Personal 包装创建 `origin_kind=user_epub`、所有者为当前用户、`visibility=private` 并入队解析。
- Catalog 包装创建无所有者 Catalog Work 并保留既有 Catalog 工作流策略。
- 经认证 `POST /api/works` 创建 Personal Work。
- Admin 页面与 API 迁至 `/admin/catalog/works` 与 `/api/admin/catalog/works`，无旧 Admin 别名。
- Admin 音频路由在 Catalog 下变为 Work/Part 作用域。
- `workflowStep=tts` 在服务端筛选。默认工作流自动链仍关闭。

## 4. Git 变更摘要

51 条路径：6 新增、39 修改、1 删除、5 重命名。34 条生产路径、15 条测试路径与 4 条文档路径。无 DB schema/迁移或依赖变更。

## 5. 逐文件变更清单

共享摄取与策略：
- apps/backend/src/domains/ingest/epub/work-upload.ts - 通用上传规格、清理、对象获取、持久化与解析入队。
- apps/backend/src/domains/ingest/parser/epub-parser.ts；registry.ts；service.ts - 解析器输入/分发/服务流支持共享 Work 摄取。
- apps/backend/src/domains/works/personal/personal-epub-upload.ts - Personal 归属/可见性包装。
- apps/backend/src/domains/works/catalog/policy.ts - 无所有者 Catalog 谓词与行检查。
- apps/backend/src/domains/works/admin/catalog-epub-ingest.ts - Catalog 上传/复用包装。
- apps/backend/src/domains/works/admin/admin-epub-ingest.ts - 移除原合并/Admin 命名的摄取所有者。
- apps/backend/src/domains/works/routes/personal.ts - 认证 Personal 上传传输。
- apps/backend/src/domains/works/routes/admin.ts；index.ts - Admin Catalog 路由注册/命名与端点迁移。
- apps/backend/src/domains/works/admin/admin-lifecycle.ts；admin-work-read.ts；admin-work-write.ts；admin/index.ts - Admin Catalog 作用域与摄取导出。
- apps/backend/src/domains/assets/routes/content-assets.ts - Admin 音频读/生成迁至 Catalog Work/Part 路径。
- apps/backend/src/application/commands/delete-work.ts；retry-workflow.ts；run-content-parse-workflow.ts；apps/backend/src/application/jobs/content-parse.ts - 共享解析器/工作流命令集成与所有者安全生命周期行为。

Web 路由与 Admin 消费者变更：
- apps/web/app/admin/works/[id]/page.tsx -> apps/web/app/admin/catalog/works/[id]/page.tsx
- apps/web/app/admin/works/[id]/preview/page.tsx -> apps/web/app/admin/catalog/works/[id]/preview/page.tsx
- apps/web/app/admin/works/[id]/preview/part/[partId]/page.tsx -> apps/web/app/admin/catalog/works/[id]/preview/part/[partId]/page.tsx
- apps/web/app/admin/works/new/page.tsx -> apps/web/app/admin/catalog/works/new/page.tsx
- apps/web/app/admin/works/page.tsx -> apps/web/app/admin/catalog/works/page.tsx
- apps/web/constants/index.ts - 路由常量跟随 Catalog 命名空间。
- apps/web/features/admin/works/work-audio-panel.tsx；works-api.ts；works-list-page.tsx；works-model.ts；works-model.spec.ts - Admin 客户端、音频路径与服务端 `workflowStep` 筛选。
- packages/shared/src/works/works.ts；works.spec.ts；index.ts - 上传契约/工作流查询变更。

测试（15）：
- apps/backend/tests/functional/domains/assets/reader-audio.spec.ts
- apps/backend/tests/functional/domains/assist/assist.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-gutenberg.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-ingest.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-enrich.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-fill.spec.ts
- apps/backend/tests/functional/domains/reading/reader.spec.ts
- apps/backend/tests/functional/domains/reading/reading-history.spec.ts
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts
- apps/backend/tests/functional/domains/taxonomy/taxonomy-ssot.spec.ts
- apps/backend/tests/functional/domains/works/personal-epub-upload.spec.ts
- apps/backend/tests/functional/domains/works/work-access-policy.spec.ts
- apps/backend/tests/functional/domains/works/works-epub.spec.ts
- apps/web/features/admin/works/works-model.spec.ts
- packages/shared/src/works/works.spec.ts
- 变更的测试覆盖上传解析、所有者隔离、Admin Catalog 隔离、音频与工作流筛选。

文档：
- docs/adr/001-reading-content-domain-model.md - 记录 Personal upload 与 Catalog 边界。
- docs/plans/user-first-architecture-implementation.md - 实现状态与检查。
- docs/product/engineering-vocabulary.md - 命名空间/status 词汇。
- docs/testing/mvp-e2e-test-guide.md - Admin/Personal 路由证据更新。

## 6. 符号 / 方法清单

新增：`EPUB_UPLOAD_SPEC`、`sanitizeEpubFileName`、`storeEpubSource`、`reuseEpubSource`、`createEpubIngestWork`、`enqueueCoreEpubParse`、`createPersonalEpubWork`、`createCatalogEpubWork`、`reuseCatalogEpubWork`、`catalogWorkPredicate`、`isCatalogWork`、`personalWorkRoutes`、`catalogAdminRoutes`。
重构：解析器分发与服务、Admin 上传导出/路由、Work 重试/删除/解析命令路径、音频路由路径、Admin 列表筛选。

## 7. 已删除代码清单

- 原 `admin-epub-ingest.ts` 实现已删除，职责在共享 `work-upload.ts` 与 `catalog-epub-ingest.ts` 间拆分。
- 旧 `/admin/works` 页面重命名为 `/admin/catalog/works`。
- 未为原 Admin API 路径添加兼容别名。
- 本阶段未删除 parser、asset、Work 或 DB 数据。

## 8. 数据库 / 数据模型

无迁移/schema 变更。Personal 上传写入 `user_epub`、`private` 可见性与当前所有者的 ReadingWork，及 `origin_file` ContentAsset。Catalog 上传写入 `admin_epub`、owner 为 null 与 Catalog 可见性。两者使用相同资源对象获取与解析核心。共享契约新增/使用 Personal 上传响应/工作流字段。

## 9. API 变更清单

新增：`POST /api/works`（需认证；多部分表单字段 `file`）。
将所有 Admin Work 操作从 `/api/admin/works...` 重命名为 `/api/admin/catalog/works...`，含创建/列表/读取/更新/发布/取消发布/重试/删除与 EPUB 上传/复用。
Admin work 音频读/生成迁至 `/api/admin/catalog/works/:workId/audio` 与 `/api/admin/catalog/works/:workId/parts/:partId/audio`。
旧 Admin 路由无别名保留。查询契约含 `workflowStep=tts`，服务端返回匹配忙碌行。

## 10. 运行时调用流

Personal：认证多部分表单路由 -> 校验大小/字段 -> `createPersonalEpubWork` -> 共享源存储/复用 -> `createEpubIngestWork`（所有者/当前用户、`private`、`user_epub`）-> `enqueueCoreEpubParse` -> 既有解析 worker 与流水线 -> PR-02 所有者读取策略允许 Reader。
Catalog：`requireAdmin` Catalog 路由 -> `createCatalogEpubWork`/复用 -> 同一共享存储/持久化核心 -> Catalog 特定自动链策略 -> 既有 Admin 处理/评审/发布。
Admin 列表：Web `workflowStep=tts` 查询 -> 服务端列表投影/筛选。不依赖浏览器端二次筛选。

## 11. 行为变更

- 用户可无 Admin 角色经 API 提交私有 Personal EPUB。
- Admin 仍仅管理 Catalog Work。
- 解析/持久化共享；访问与生命周期策略不共享。
- Personal 解析入队；Catalog 遵循既有自动链标志，默认为 false。
- Work 音频操作 Catalog 作用域。
- 本阶段不为 Personal Work 创建 Library 成员；归属成员投影在 PR-05 到达。

## 12. AI / 实现决策

- 内容哈希可复用存储对象字节，但每次上传调用仍创建新 ReadingWork。对象去重非书/Work 去重；重复上传产品语义仍开放。
- Personal 上传立即启动解析，Catalog 自动链仍由策略控制。
- 客户端文件名清理为 basename 并用作展示元数据，永不作为对象路径。
- 共享边界为摄取核心；Personal 与 Catalog 包装有意拥有不同策略。
- 遵循锁定的一次性迁移方向，未添加 API 兼容别名。

## 13. 测试与验证证据

历史 PR-04 报告：共享包/后端/Web 类型检查通过；后端定向测试 25/25、共享包 15/15、Web 5/5；范围内 ESLint、Prettier 与 `git diff --check` 通过。Personal 上传测试验证成功私有解析/阅读、其他用户/匿名拒绝、Admin Catalog 隔离、Personal 解析无 TTS 要求及畸形 EPUB 失败处理。结果未在评审关卡 01 重跑；未报告完整仓库测试套件。

## 14. 遗留审计

- Admin `/works` 运行时路径替换为 Catalog 路径且无别名。
- 仅 Admin 上传不再是唯一摄取入口；`POST /api/works` 为 Personal。
- 无 Personal 上传 UI。
- TTS 为工作流步骤，非 Work `processingStatus`。Catalog 发布门控仍要求 `ready` 与默认 US 音频。
- 既有书架与 `reading_state` 成员语义保留至 PR-05。

## 15. 范围审计

所有变更支持共享摄取、Personal 后端上传、Catalog 路由归属、工作流查询行为及其消费者/测试/文档。无 Library 领域/UI、Provider 解析器、设置 UI 或 schema 变更。Admin Web 页面搬迁为必要的路由消费者迁移，非后续用户优先学习者前端重写。

## 16. 前端影响

Admin 页面搬迁且 Admin 客户端更新为 Catalog 路径。未新增学习者上传 UI。未实现 Library 体验或完整用户优先导航改版。

## 17. 复杂度增长

新增一个共享 EPUB 摄取核心与两个真实策略包装、两个真实消费者。Catalog 谓词有 SQL 与行形式以适配不同执行边界。路由处理器保留独立多部分表单校验。后续评审应检查能否在不合并 Personal/Admin 策略的前提下减少校验重复。

## 架构减法候选

- `isCatalogWork` 在 `delete-work.ts` 有真实调用方。评审其仅行策略是否应与用于 SQL 作用域的 `catalogWorkPredicate` 分离保留。
- 评审 Catalog 谓词与已发布 Catalog 读取谓词重叠；不同发布要求可能为两者并存提供依据。
- 评审路由级多部分表单校验与共享上传规格的重复。

## 隐藏产品决策

- 重复上传同一 EPUB 在复用字节时仍创建另一 Work：PR04-PRODUCT-001。
- Personal 上传为私有且解析立即开始；可见上传位置与处理/重试体验此处未决。
- Catalog 取消发布与保存用户成员生命周期由 PR-05 来源行为澄清，但仍需产品归属。
