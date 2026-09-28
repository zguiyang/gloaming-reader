# PR-02 — 统一 Work 读取访问策略

状态：已实现
实现提交：a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6
基线提交：a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4
分支：codex/user-first-pr02-work-access-policy
主要领域：Work 归属感知读取访问
实现范围：以共享执行者/策略替代通用「仅已发布」访问，覆盖内容消费者
评审类型：架构审计 / 维护者交接（Architecture Audit / Maintainer Handoff）
人工评审：待完成

## 1. 本阶段为何存在

PR-01 之后，schema 可表示私有所有者 Work，但运行时读取仍假设每个可读 Work 均已发布。PR-02 使单一规则治理 Reader、资源、会话、Assist、翻译、词典、历史、推荐与书架。

## 2. 之前

仅已发布辅助逻辑门控读取路径。私有 Work 的所有者无法通过同一受支持的 Reader/内容调用链读取。消费者有本地可见性检查或依赖与发布绑定的辅助命名。

## 3. 之后

`WorkReadActor` 为与传输无关的身份形态。Work 可由所有者、Admin 读取，或对已发布无所有者 Catalog Work 由任意 actor 读取。SQL 谓词保护查询路径；`canReadWorkRow` 保护已加载行/asset/history 路径。Part 继承其 Work 的策略。

## 4. Git 变更摘要

39 条路径：6 新增、31 修改、1 删除、1 重命名。新增执行者、策略、谓词与访问测试；`published.ts` 重命名为 `part-audio-track.ts`。无 schema、迁移、Web 或公共路由路径变更。

## 5. 逐文件变更清单

新增生产文件：
- apps/backend/src/domains/works/access/actor.ts - 最小 `WorkReadActor`、匿名/默认身份与 Admin 角色辅助。
- apps/backend/src/domains/works/access/predicate.ts - 纯行检查及公共 Catalog 与 actor 读取的 SQL 谓词。
- apps/backend/src/domains/works/access/policy.ts - 可读 Work/Part 加载器、title/id 解析器与 `assertCanReadWork`。
- apps/backend/src/domains/works/access/index.ts - 内部领域导出。

变更的生产路径：
- apps/backend/src/domains/assets/content/published.ts -> part-audio-track.ts - 音轨解析使用 readable-part 访问。
- apps/backend/src/domains/assets/gateway/service.ts；assets/index.ts；routes/assets.ts - asset 可见性与交付使用 actor policy。
- apps/backend/src/domains/assist/routes/index.ts；service.ts；tools.ts - Assist work/part context 遵循 actor。
- apps/backend/src/domains/conversations/routes/index.ts；service.ts - conversation 作用域检查对其 Work 的访问。
- apps/backend/src/domains/dictionary/lookup/enrichment.ts；service.ts；routes/index.ts - lookup/enrichment context 使用可读内容。
- apps/backend/src/domains/reading/history/query.ts；reader/service.ts；reader/state-mutations.ts；routes/history/user.ts；routes/reader.ts - history 与 Reader 使用 owner 感知访问。
- apps/backend/src/domains/recommendations/service.ts - 仅推荐已发布 Catalog Work。
- apps/backend/src/domains/shelf/service.ts - 书架服务对其行筛选为公共 Catalog 可见性。
- apps/backend/src/domains/translate/routes/index.ts；service.ts - translation context 检查可读 Part。
- apps/backend/src/domains/works/catalog/catalog.ts；catalog/index.ts；routes/catalog.ts - 公共 Catalog 行为共享发布谓词，非 Catalog 详情可使用读取访问。
- apps/backend/src/domains/works/read-model/access.ts -> 已移除；read-access 归属迁至 works/access。`read-model/index.ts` 已更新。
- apps/backend/src/domains/works/access 模块为中央策略所有者。

测试（8）：
- apps/backend/tests/functional/domains/assets/assets.spec.ts
- apps/backend/tests/functional/domains/conversations/conversations.spec.ts
- apps/backend/tests/functional/domains/dictionary/dictionary-config.spec.ts
- apps/backend/tests/functional/domains/recommendations/recommendations-catalog-policy.spec.ts
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts
- apps/backend/tests/functional/domains/works/work-access-policy.spec.ts
- apps/backend/tests/unit/domains/dictionary/dictionary-context-isolation.spec.ts
- apps/backend/tests/unit/domains/dictionary/dictionary-route.spec.ts
- 覆盖所有者、其他用户、匿名与 Admin 边界、公共 Catalog 筛选与消费者上下文隔离。

文档：
- docs/plans/user-first-architecture-implementation.md - 记录访问阶段与验收证据。

## 6. 符号 / 方法清单

新增：`WorkReadActor`、`anonymousWorkReadActor`、`workReadActorFromIdentity`、`isWorkReadAdmin`、`WorkAccessRow`、`isPublicCatalogWork`、`canReadWorkRow`、`publicCatalogWorkSql`、`workReadAccessSql`、`requireReadableWorkWithParts`、`requireReadablePart`、`resolveReadableWorkTitle`、`resolveReadableWorkIdForPart`、`assertCanReadWork`。
迁移的调用点包括 `getReaderParts`/`getReaderPart`/`getReadingState`/`updateReadingState`、asset 授权/音频解析、conversation create/list/read、Assist、translate、dictionary、history 与 recommendations。

## 7. 已删除代码清单

- `requirePublishedWorkWithParts` 与 `requirePublishedPart` 由归属感知可读辅助替代。
- `apps/backend/src/domains/works/read-model/access.ts` 已删除。
- 旧「已发布内容」辅助文件名重命名为 `part-audio-track.ts`；音轨能力保留。
- 公共路由与响应契约未移除。

## 8. 数据库 / 数据模型

无 schema 或迁移变更。策略读取 PR-01 新增/澄清的 `owner_user_id`、`visibility` 与 `published_at`。

## 9. API 变更清单

无 URL 或响应 schema 变更。既有 Reader/内容 API 语义对所有者访问放宽，同时为非所有者保留已发布 Catalog 访问。被拒绝与不存在的 Work 仍通过访问辅助中的「未找到」路径解析。

## 10. 运行时调用流

HTTP 身份 -> `workReadActorFromIdentity` -> 服务级可读 Work/Part 加载器或 SQL 谓词 -> 请求的 Reader/AI/历史/资源操作。
资源路由 -> 资源元数据 -> `canReadWorkRow`/`isPublicCatalogWork` -> 授权字节或拒绝。
Catalog/推荐查询 -> `publicCatalogWorkSql`；私有 Work 不进入公共 Catalog 结果。

## 11. 行为变更

- 所有者可经共享 Reader 策略读取自己的私有 Work 与 parts。
- 匿名与其他用户访问仍限于已发布无所有者 Catalog Work。
- Admin 策略仍显式。
- 资源与 AI 上下文不再推断「已发布」是唯一可读 Work 的理由。

## 12. AI / 实现决策

- 策略同时使用 SQL 与内存谓词，使数据库筛选读取与已加载行共享等价规则。有意为不同执行形式，但可能漂移。
- 不可读与不存在的 Work 通过「未找到」行为隐藏。
- 读取执行者为最小纯对象而非 Hono/session 类型，使领域服务独立于传输。
- 本阶段 GitNexus 陈旧；前一阶段报告记录手动源码/调用点评审。

## 13. 测试与验证证据

历史 PR-02 报告：13 个后端回归测试文件，47/47 项测试；后端类型检查、ESLint 与 `git diff --check` 通过。聚焦后续新增推荐与书架策略回归用例。结果未在评审关卡 01 重跑。未报告完整仓库测试。

## 14. 遗留审计

- `requirePublished*` 从活跃访问路径移除，非所有发布检查。
- 已发布 Catalog 仍为非所有者的公共读取条件。
- 归属感知访问为当前运行时行为；架构不暗示任意认证用户可读他人私有 Work。

## 15. 范围审计

变更为后端读取策略、其消费者与测试。无认证机制、表、公共路径、provider 行为或 Library 契约变更。

## 16. 前端影响

无 Web 源码变更。既有端点形态保留；所有者现可使用这些路径读取私有内容。前端 Library 表面在 PR-05 到达。

## 17. 复杂度增长

新增四个访问模块文件与一个共享策略。模块在跨领域有多个真实消费者，其共享归属有证据。候选评审：比较纯行谓词与 SQL 谓词漂移；若各调用方需要不同查询边界则保留两者。

## 架构减法候选

- 四文件访问模块的入口结构可能多于所需；除非用法显示更简单内聚单元，保留执行者、谓词与编排的语义分离。
- SQL 与行谓词将同一策略编码两次。

## 隐藏产品决策

- 将被拒绝与不存在的 Work 隐藏在「未找到」之后为用户/安全行为；当前实现已确认，但错误披露策略应仍为显式访问契约。
- 推荐与公共列表仍为仅 Catalog，尽管所有者可读私有 Work。此为有意的产品/安全区分，非认证的普遍后果。
