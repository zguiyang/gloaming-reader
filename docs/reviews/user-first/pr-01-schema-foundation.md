# PR-01 — Schema 基础

状态：已实现
实现提交：a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4
基线提交：4efa89a9944561ad4f57b37d57f115fd78f7f43f
分支：codex/user-first-pr01-schema-foundation
主要领域：Schema 与共享 Work 生命周期契约
实现范围：将处理与发布拆分；创建 Library 成员存储；新增 Provider 归属列
评审类型：架构审计 / 维护者交接（Architecture Audit / Maintainer Handoff）
人工评审：待完成

证据依据：提交 diff 4efa89a9..a7804424、迁移 0036、Drizzle schema、共享 Work 契约、当前源码与调用点。实现计划为意图/验证记录，非运行时证明。

## 1. 本阶段为何存在

此前 Work status 混合流水线进度、TTS 与发布。Schema 亦缺乏显式 Library 成员存储，且无法编码 Provider/配置归属。PR-01 建立访问、摄取、Library、Provider 与设置所需的持久化与共享契约形态。未实现这些后续运行时特性。

## 2. 之前

- `reading_work.status` 允许 `uploaded`、`processing`、`parsed`、`metadata`、`tts`、`ready`、`failed`、`published`。
- 发布与处理共用同一字段。
- `reading_state` 在文档与使用中同时作为书架成员与位置。
- `llm_provider`、`llm_app_setting`、`tts_config` 无 `owner_user_id`。
- 共享 Work 数据传输对象与 Admin 筛选暴露合并的 status 模型。

## 3. 之后

- `reading_work.processing_status` 含 `uploaded`、`processing`、`parsed`、`metadata`、`ready`、`failed`。
- `reading_work.published_at` 为发布事实；Work 数据传输对象与 Admin 列表查询分别暴露 `processingStatus` 与 `publicationStatus`。
- `user_library_item` 存在，含 `user_id`/`work_id` 唯一及 user/work 索引。
- Provider/config 表有可空 `owner_user_id` 与作用域唯一约束。
- Admin 与工作流代码使用 `processingStatus`。访问策略与 Library 增删改查在后续阶段。

## 4. Git 变更摘要

55 条路径变更：3 新增、52 修改、0 删除。范围新增迁移 0036 及其 journal 条目，变更 DB schema，更新 backend/web 消费者，变更 17 条测试路径与 3 条文档路径。无路由注册文件变更。

## 5. 逐文件变更清单

生产路径（36）：
- apps/backend/scripts/seed-dev-works.ts - 种子数据使用 `processingStatus`。
- apps/backend/src/application/commands/advance-tts-workflow.ts；delete-work.ts；retry-workflow.ts；run-content-parse-workflow.ts - 工作流/删除命令使用新 Work 生命周期字段。
- apps/backend/src/application/jobs/metadata-enrich.ts - 任务转换使用 `processingStatus`。
- apps/backend/src/domains/ai/runtime/purpose-model.ts - 实例 setting 查找为所有者为 null 的作用域。
- apps/backend/src/domains/assets/content/published.ts；gateway/service.ts - 发布/访问投影使用 `publishedAt` 事实。
- apps/backend/src/domains/llm/config/settings/service.ts - 实例 settings 使用 `owner_user_id` null。
- apps/backend/src/domains/metadata/enrich/workflow-service.ts；workflow.ts - 元数据转换使用处理状态。
- apps/backend/src/domains/recommendations/service.ts - Catalog 可见性使用发布时间。
- apps/backend/src/domains/shelf/service.ts - 书架服务使用 `publishedAt`，但本阶段仍从 `reading_state` 推导成员。
- apps/backend/src/domains/works/admin/admin-epub-ingest.ts；admin-lifecycle.ts；admin-work-read.ts；admin-work-write.ts - Admin 摄取、筛选、发布与数据传输对象映射使用拆分字段。
- apps/backend/src/domains/works/catalog/catalog.ts - 公共 Catalog 筛选使用 `publishedAt`。
- apps/backend/src/domains/works/lifecycle/workflow.ts - 工作流 claim/转换使用 `processingStatus`。
- apps/backend/src/domains/works/read-model/access.ts；projection.ts - 访问与 Work 投影使用新字段。
- apps/web/features/admin/works/metadata-review-panel.tsx；works-api.ts；works-edit-page.tsx；works-format.ts；works-list-page.tsx；works-model.spec.ts；works-model.ts；works-preview-page.tsx - Admin UI/API 筛选与标签遵循拆分。
- apps/web/features/book-detail/book-detail-model.spec.ts；apps/web/features/discover/discover-api.spec.ts - 消费者契约测试遵循修订后的 Work 形态。
- packages/db/src/index.ts；schema.ts - DB 导出/模型定义更新。
- packages/shared/src/works/index.ts；works.spec.ts；works.ts - 共享 status 枚举、schema 与数据传输对象契约变更。

迁移路径：
- packages/db/migrations/0036_user_first_pr01_schema_foundation.sql - 创建成员；迁移 status；新增 owner 列/索引；从每条 `reading_state` 行回填。
- packages/db/migrations/meta/_journal.json - 注册迁移 0036。

文档路径：
- docs/adr/001-reading-content-domain-model.md - 用户优先 schema 方向修订。
- docs/plans/user-first-architecture-implementation.md - 记录顺序与实现范围。
- docs/product/engineering-vocabulary.md - status 与字段词汇更新。

测试路径（17）：
- apps/backend/tests/functional/domains/assets/assets.spec.ts
- apps/backend/tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts
- apps/backend/tests/functional/domains/dictionary/dictionary-config.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-gutenberg.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-ingest.spec.ts
- apps/backend/tests/functional/domains/llm/llm-config.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-enrich.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-fill.spec.ts
- apps/backend/tests/functional/domains/taxonomy/taxonomy-ssot.spec.ts
- apps/backend/tests/functional/domains/translate/translate.spec.ts
- apps/backend/tests/functional/domains/works/catalog-taxonomy.spec.ts
- apps/backend/tests/functional/domains/works/works-epub.spec.ts
- apps/backend/tests/unit/domains/taxonomy/read-side-taxonomy-contract.spec.ts
- apps/web/features/admin/works/works-model.spec.ts
- apps/web/features/book-detail/book-detail-model.spec.ts
- apps/web/features/discover/discover-api.spec.ts
- 测试适配相关 Work 消费者；数据库约束功能测试覆盖成员与 Provider 作用域唯一性。

## 6. 符号 / 方法清单

- 新增/权威：`userLibraryItem`、`userLibraryItemRelations`、`WORK_PROCESSING_STATUSES`、`WorkProcessingStatus`、`workProcessingStatusSchema`、`WORK_PROCESSING_STATUS_LABELS`、`processingStatus`/`publicationStatus` 数据传输对象与查询字段。
- 重构：Admin Work 读写、Work 投影/访问、流水线命令/任务、Admin work model/筛选辅助、TTS 工作流转换。
- 变更的发布消费者：`isWorkPublished` 与 Catalog/Shelf/access 谓词从 `publishedAt` 推导发布。
- Provider 归属在本阶段仅为 schema；未新增用户 Provider 解析器或用户设置相关方法。

## 7. 已删除代码清单

- `reading_work.status` 由迁移与 schema 更新移除。
- `WorkStatus`、`WORK_STATUSES`、`workStatusSchema` 及将 `published`/`tts` 作为处理状态的标签被替换。
- 本阶段未删除 API 路由、服务或目录。

## 8. 数据库 / 数据模型

迁移 0036 将旧 `tts` 与 `published` status 值映射为 `ready`；其他已知值原样复制。创建 `user_library_item` 并为每条 `reading_state` 行插入一行，以 `added_at` 作为 `created_at`。此为全量回填，非恢复的用户意图。Provider 与配置表的 owner 列为可空；部分唯一索引区分实例级与用户级 setting 键并强制单一实例 TTS 配置。此为 PR-01..05 中唯一触及的版本化 schema 迁移。

## 9. API 变更清单

无路由注册变更。共享 Admin Work 载荷/列表查询契约由 `status` 变为 `processingStatus` 加 `publicationStatus`；旧 `status` 非兼容别名。Admin 路径变更属于 PR-04；Library API 属于 PR-05。

## 10. 运行时调用流

Admin 列表/编辑 -> Admin Work 服务 -> `processingStatus` 与 `publishedAt` 筛选/投影。
解析、元数据、重试、TTS 命令 -> Work 生命周期转换 -> `processing_status`。
Catalog/书架/资源可见性 -> `published_at` 谓词。
迁移 0036 -> 成员行与可承载 owner 的 provider schema。Provider 运行时行为尚未使用用户归属。

## 11. 行为变更

- TTS 与发布不再是 `processingStatus` 值。
- 既有 `tts`/`published` 行变为处理就绪；发布由 `published_at` 表示。
- 本阶段 `reading_state` 仍驱动书架成员。
- Provider 服务仍作为实例配置运行。

## 12. AI / 实现决策

- 迁移将 `tts` 与 `published` 均译为 `ready`。符合拆分，但为遗留行选择回退处理值。
- 复制每条 `reading_state` 行到 `user_library_item`，以 `added_at` 作为成员时间。无来源区分显式保存与自动打开；见 PR05-HISTORY-001。
- `llm_app_setting` 由 key 主键改为生成 `id` 加部分唯一索引。属存储实现选择；purpose/key 契约保留。
- 未知遗留 status 值使迁移失败，而非静默强制转换。

## 13. 测试与验证证据

历史阶段报告 / 计划记录：
- 共享 Work 契约：14/14。
- PR-01 schema constraints：4/4，数据库 `gloaming_test`。
- Work EPUB 回归：19/19；聚焦后端功能测试集：13 文件 / 97 项测试。
- Web Admin/图书详情/发现页：33/33。
- 共享包、后端、Web 类型检查与范围内代码检查通过。
- 这些历史结果未在评审关卡 01 重跑。本阶段未报告运行完整单体仓库测试/类型检查/代码检查。

## 14. 遗留审计

- 确认移除：DB/运行时 `reading_work.status` 及处理枚举成员 `tts`/`published`。
- 替换而非移除：发布继续为 `published_at`；TTS 继续为工作流步骤与资源就绪要求。
- 仍存在于本阶段：`reading_state` 推导的书架成员；PR-05 稍后替换运行时语义。
- Provider owner 列非运行时用户作用域。

## 15. 范围审计

范围为 Schema 基础及新字段契约所需的消费者。未实现 Provider UI/解析器、Library API、用户读取访问策略、Admin 路由迁移或设置流程。全量 Library 回填属于 schema 阶段，仍为人工数据决策。

## 16. 前端影响

Admin Work 状态展示/筛选将处理与发布分离。发现页与图书详情契约测试遵循修订后的 Work 形态。非用户优先前端重写；未引入 Library 页面或用户设置 UI。

## 17. 复杂度增长

新增一张成员表、provider 归属字段/索引及处理/发布契约分离。这些是不同生命周期/归属概念所需的持久化事实。评审部分索引约束与 status/回填选择；未添加转发包装。

## 架构减法候选

- PR-02 后复审 SQL 与内存发布谓词是否皆需要；查询路径与已加载行路径可能各需其一。
- 在声称用户作用域 provider 支持前，与 PR-06 一并评审 provider 归属约束。

## 隐藏产品决策

- 历史 `reading_state` 回填语义：PR05-HISTORY-001。
- 遗留 `tts`/`published` 行均变为处理就绪。确认运营是否需要可区分的迁移后处理阶段。
