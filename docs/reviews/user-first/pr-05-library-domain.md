# PR-05 — Library 领域

状态：已实现
实现提交：dd60b348a482268f126a2de936941a120225f005
基线提交：d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04
分支：codex/user-first-pr05-library-domain
主要领域：Library（书架）成员、阅读进度与历史
实现范围：以「拥有 + 保存」的 Library 替代 Shelf 领域/API/契约，并分离继续阅读
评审类型：架构审计 / 维护者交接（Architecture Audit / Maintainer Handoff）
人工评审：待完成

## 1. 本阶段为何存在

PR-05 之前，`reading_state` 同时服务进度与 Shelf 成员。这使自动打开与显式保存无法区分。PR-05 使 Personal 归属隐含 Library 存在、Catalog 存在要求 `user_library_item`，且 `reading_state` 为可选进度装饰。阅读历史仍为独立行为记录。

## 2. 之前

- 后端 `GET /api/shelf` 基于 `reading_state` 返回 Work 列表。
- Shared `ShelfData`/`ShelfItem` 与 `packages/shared/shelf` 表示契约。
- Web `features/shelf` 从 `/my-shelf` 消费 Shelf API。
- `updateReadingState` 接受 `add_to_shelf`。
- Book Detail 混合进度与成员行为。

## 3. 之后

- `GET /api/library` 返回拥有的 Personal Work 与显式已发布 Catalog 保存的并集，各带可选阅读状态。
- 继续阅读从可访问的 `in_progress` `reading_state` 单独查询，可为未保存项。
- `POST /api/library/:workId` 添加已发布 Catalog 成员；重复添加为成功且空操作。
- `DELETE /api/library/:workId` 仅移除 `user_library_item`；`reading_state` 保留。
- 打开/重启可创建进度但不能创建 Library 成员。
- Shared 与 Web 模块命名为 library；`/my-shelf` 路径保留。

## 4. Git 变更摘要

64 条路径：12 新增、33 修改、12 删除、7 重命名。47 条生产源码路径、14 条测试路径、9 条文档路径。无迁移/schema 行为或依赖变更；`packages/db/src/schema.ts` 仅改注释。

## 5. 逐文件变更清单

后端 Library 与路由组合：
- apps/backend/src/domains/library/index.ts；routes/index.ts；service.ts - 新 Library 所有者、认证 GET/POST/DELETE 路由、并集/进度投影、幂等成员变更。
- apps/backend/src/routes/index.ts - 以 `libraryRoutes` 挂载替代 `shelfRoutes`。
- apps/backend/src/domains/shelf/index.ts；routes/index.ts；service.ts - 移除 Shelf 后端模块。

Reader、历史与测试：
- apps/backend/src/domains/reading/reader/state-mutations.ts - 移除 `add_to_shelf` 操作；打开/重启保留进度创建。
- apps/backend/tests/functional/domains/library/library.spec.ts - 显式成员、读模型与幂等用例。
- apps/backend/tests/functional/domains/reading/reader.spec.ts；reading-history.spec.ts - 断言进度/历史不再隐含成员。
- apps/backend/tests/unit/domains/taxonomy/read-side-taxonomy-contract.spec.ts - Library 分类契约覆盖。
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts - 旧套件移除并由 Library 测试替代。

Web 页面与功能模块迁移：
- apps/web/app/(app)/my-shelf/page.tsx - 路由组合 Library 功能模块，路径保留。
- apps/web/features/shelf/shelf-book-card.tsx -> apps/web/features/library/library-book-card.tsx
- apps/web/features/shelf/shelf-continue-hero.tsx -> apps/web/features/library/library-continue-hero.tsx
- apps/web/features/shelf/shelf-empty-state.tsx -> apps/web/features/library/library-empty-state.tsx
- apps/web/features/shelf/shelf-grid.tsx -> apps/web/features/library/library-grid.tsx
- apps/web/features/shelf/shelf-page.tsx -> apps/web/features/library/library-page.tsx
- apps/web/features/shelf/shelf-skeleton.tsx -> apps/web/features/library/library-skeleton.tsx
- apps/web/features/shelf/shelf-taxonomy.spec.ts -> apps/web/features/library/library-taxonomy.spec.ts
- apps/web/features/library/index.ts；library-api.ts；library-client.ts；library-public.spec.ts；library-public.ts - 新 Library 客户端、公共接缝及其测试。
- apps/web/features/shelf/index.ts；shelf-api.ts；shelf-public.spec.ts；shelf-public.ts - 旧 API/公共接缝删除。
- apps/web/features/reading-state/reading-state-api.ts；reading-state-client.ts - 移除旧添加/保存耦合；API 客户端删除。
- apps/web/features/book-detail/book-detail-api.ts；book-detail-hero.tsx；book-detail-model.ts；book-detail-model.spec.ts；book-detail-page.tsx - 成员变更/查询与进度分离。
- apps/web/features/discover/discover-api.ts；discover-api.spec.ts；discover-book-card.tsx；discover-model.ts - Discover 集成显式 Library 操作。
- apps/web/features/reader/reader-api.ts；apps/web/lib/api-request.spec.ts - 端点/client 契约更新。

共享契约与文案：
- packages/shared/src/library/index.ts；library.ts；library.spec.ts - Library 数据传输对象、上限与 schema 替代 Shelf 契约。
- packages/shared/src/shelf/index.ts；shelf.ts；shelf.spec.ts - 旧 Shared 模块移除。
- packages/shared/src/reader/reader.ts - 从 reading-state actions 移除 `add_to_shelf`。
- packages/shared/src/public-exports.spec.ts；packages/shared/package.json - 公共子路径与导出断言迁移至 library。
- packages/db/src/schema.ts - 成员注释现描述 Library 与独立进度；schema 未变。
- packages/i18n/src/messages/en-US.json；packages/i18n/src/messages/zh-CN.json - Shelf 面向文案迁至 Library 用语。

文档（9）：
- docs/adr/001-reading-content-domain-model.md - 已接受领域拆分与当前 Library/继续阅读语义更新。
- docs/adr/003-shared-package-public-api-strategy.md - Shared 模块图更新。
- docs/adr/006-frontend-shelf-and-reader-parts-public-seams.md - 前端接缝决策更新。
- docs/plans/user-first-architecture-implementation.md - 记录 PR-05 完成。
- docs/product/BOOK_DETAIL_DESIGN_CONTEXT.md；content-strategy.md；engineering-vocabulary.md；feature-audit.md - 产品/领域词汇与当前表面更新。
- docs/testing/mvp-e2e-test-guide.md - 端点/页面证据路径更新。

## 6. 符号 / 方法清单

新增：`LibraryData`、`LibraryItem`、`LIBRARY_ITEMS_LIMIT`、`libraryDataSchema`/`libraryItemSchema`、`getLibrary`、`addToLibrary`、`removeFromLibrary`、`libraryRoutes`、Library API/客户端/公共接缝。
变更：`updateReadingState` 不再在 `add_to_shelf` 上创建成员；图书详情/发现页模型将 Library 状态与 Reader 进度分离。
移除：`ShelfData`/`ShelfItem` 导出与 shelf 路由/服务/API/客户端/公共符号；`add_to_shelf` 操作。

## 7. 已删除代码清单

- 后端 `domains/shelf`、共享包 `packages/shared/shelf` 与 Web `features/shelf` 实现/API/公共接缝已移除或迁至 library。
- `reading_state` `add_to_shelf` 变更路径与 Web `reading-state-client` 已移除。
- `/api/shelf` 已移除且无别名。`/my-shelf` 路由有意保留。
- 迁移 0036 及其数据未变。

## 8. 数据库 / 数据模型

PR-05 无新数据库结构。迁移 0036 的 `user_library_item` 现为成员 SSOT。拥有 Work 按 `reading_work.owner_user_id=user` 选取；保存 Catalog Work 连接 `user_library_item` 并要求已发布 Catalog 可见性。`reading_state` 左连接为可选进度。迁移 0036 的历史全量回填仍未决。

### 历史 Library 回填决策

当前事实：迁移 0036 为 `reading_state` 中每行插入 `user_library_item`，以 `added_at` 作为 `created_at`。原 `reading_state` 行可能来自显式保存或自动打开/阅读。无已确认行字段记录创建原因。

影响：仅迁移时存在的行有歧义。新行为不从 `reading_state` 推断 Library 成员。

- 全部保留：保留有意历史保存，但也保留任何自动创建阅读状态的表象保存。
- 全部删除：移除误报，但也永久移除真实有意保存，除非另有来源可恢复。
- 选择性恢复：需要来源追溯。`reading_state`/迁移 0036 中的区分字段未确认；schema 或迁移中未发现可靠分类证据。
- 决策：需人工产品/数据决策。未执行删除、新回填、迁移或选择。

## 9. API 变更清单

- `GET /api/library` 替代 `GET /api/shelf`。
- `POST /api/library/:workId` 添加显式成员，限于已发布 Catalog Work。
- `DELETE /api/library/:workId` 仅移除成员，无行时仍成功。
- 既有 Reader 状态 GET/PATCH 保留；从其操作契约移除 `add_to_shelf`。
- 共享 Library 条目 Work 投影含 id、title、description、tags、coverAssetId、`publishedAt` 与可选状态；不暴露 `processingStatus` 或显式来源/成员类型字段。

## 10. 运行时调用流

Library 页面 `/my-shelf` -> Library 客户端 -> `GET /api/library` -> `getLibrary`：
  current = 最新可访问 `in_progress` ReadingState + Work
  items = 拥有 Work 并集显式保存的已发布 Catalog Work，各带可选状态
发现页/图书详情 -> `POST`/`DELETE /api/library/:workId` -> `addToLibrary`/`removeFromLibrary` -> 仅 `user_library_item`。
Reader PATCH 打开/重启 -> `updateReadingState` -> 仅 `reading_state`；无成员写入。
阅读历史 -> 既有历史查询/心跳 -> 历史行为仍独立。

## 11. 行为变更

- 阅读 Catalog 不再自动添加 Library 成员。
- 已保存 Catalog Work 可无进度行。
- 从 Library 移除 Catalog Work 保留阅读进度/历史。
- Personal Work 因归属自然为 Library 成员。
- 当前继续阅读可展示未保存 Work。
- 当前 API 返回合并列表上限 50，拥有按 Work 创建、保存 Catalog 按成员创建排序，再按该时间戳合并。

## 12. AI / 实现决策

- 继续阅读留在 Library 响应/页面，查询逻辑仍分离。
- Catalog 成员仅在 Work 已发布时可见；取消发布期间行仍持久。
- 拥有与保存 Work 使用单一 Work 摘要形态；本 Library 投影不返回 origin 与处理状态。
- Library 结果固定 50 条上限与最新时间戳排序。
- 删除语义在代码中不对称设计：Library DELETE 移除 Catalog 成员行；未新增 Personal Work 删除端点。
- API/领域用语变更同时保留 `/my-shelf` 为路由。

## 13. 测试与验证证据

历史 PR-05 报告：
- Library 功能测试：3/3。
- Reader/历史/访问/Personal/推荐回归：9/9。
- 后端分类：4/4。
- 共享包：154/154。
- Web 定向集：47/47。
- 后端、Web、共享包类型检查；范围内 ESLint、Prettier 与 `git diff --check` 通过。
- 未运行完整后端套件。结果未在评审关卡 01 重跑。

## 14. 遗留审计

- 运行时确认移除：Shelf 后端/共享包/Web 模块、`/api/shelf` 与 `add_to_shelf` 操作。
- 有意保留：`/my-shelf` URL 与导航/Reader 返回引用。
- `reading_state` 仍用于进度/历史；仅其 Library 成员角色对未来行为移除。
- 遗留历史成员行待人工决策。
- Shelf 术语仍存在于历史文档、旧路由命名与部分产品文档。

## 15. 范围审计

PR-05 为 Library 领域及停止使用 Shelf 并分离进度所需的消费者迁移。变更 Web Library/图书详情/发现页调用点，但未实现学习者 EPUB 上传 UI、用户优先应用外壳、Provider、Settings 或惰性 TTS。文档与 UI 迁移在 Library 垂直切片内。

## 16. 前端影响

Library 功能模块替代 Shelf 内部，App Router 路径仍为 `/my-shelf`。发现页与图书详情暴露显式 Library 成员。Reader API 仍在 `reading_state`。完整导航/路由重命名与 Personal 上传/处理流程未实现。

## 17. 复杂度增长

新增后端 Library 服务/路由、共享 Library 契约与 Web Library 功能模块。既有 Shelf 组件多为重命名/精炼而非全新。该拆分对应不同成员语义。在扩展 UI 前评审合并 current/items 响应体、单一 50 条上限、本地 Work 映射器与缺失的来源/处理元数据。

## 架构减法候选

- `in_progress` Work 单独投影为 current，也可能出现在 items；在决定重复表示是否多余前检查 UI 用法与测试预期。
- Library 服务有本地 Work 摘要映射器；在保留两者前与既有 Work/读模型映射器比较。
- `WorkRead` SQL 与内存谓词仍为同一访问规则的并行表示。
- Library API/客户端/公共文件为独立接缝；各应保留其所有者/消费者理由。
- Shelf 兼容模块已移除而非留作转发包装。

## 隐藏产品决策

- PR05-HISTORY-001 历史成员数据决策。
- PR03-PRODUCT-002 取消发布/保存持久化行为。
- PR04-PRODUCT-001 重复上传语义。
- Library 名称/路由、来源标签/分组、上传位置/处理生命周期、个人删除、排序/上限、迁移项可见性与 Admin Catalog 文案仍待产品评审。既有产品文件在部分来源标签与 Shelf 流程用语上不一致；见摘要风险发现。
- 既有产品流程称继续阅读属于本表面且 Reader 返回 Library；为当前已记录决策，此处不重开。
