# Frontend User-first Delta Audit

> 本文是 `frontend-design-baseline.md` 的业务事实增量核验，不重写视觉语言、Design Tokens、Reader、组件与响应式基线。审计只读，未修改 runtime code。

## 1. Git 基线门禁

| 项目 | 确认值 |
|---|---|
| 分支 | `codex/user-first-pr06-provider-resolver` |
| Worktree | `/Users/joyzhao/.codex/worktrees/user-first-pr06-provider-resolver/gloaming-reader` |
| HEAD | `da5ede8b83673ec981459fea0091d8d9f5cdb279` — `docs(review): record PR-06 provider resolver` |
| PR-06 implementation | `b481a2fad4480f8d084d6e1a7fa7f6e96633db53`，HEAD 的直接父提交，故为 ancestor |
| PR-06 review | `da5ede8b83673ec981459fea0091d8d9f5cdb279`，与 HEAD 相同，故为 ancestor |
| PR-01～PR-05 | 当前提交链包含 PR-01 schema、PR-02 access、PR-03 publication、PR-04 ingest/catalog、PR-05 Library 的实现/checkpoint commits；PR 阶段索引与各阶段文档也在当前源码树 |
| 工作树 | 基线检查时 clean |

门禁通过，继续基于此 HEAD 审计。此分支没有 `docs/reviews/user-first/frontend-design-baseline.md` 文件；本文件按请求单独记录增量，不复制或重建此前的完整设计基线。

### 证据文件

- `docs/reviews/user-first/README.md`：PR-01～PR-06 commit/阶段索引及遗留迁移表。
- `docs/reviews/user-first/pr-04-ingest-catalog.md`：Personal 上传与 Admin Catalog 分流。
- `docs/reviews/user-first/pr-05-library-domain.md`：Library API、成员语义、进度/History 边界与前端影响。
- `docs/reviews/user-first/pr-06-provider-resolver.md`：用户 LLM/TTS 设置 API、作用域解析、没有用户 UI 的范围声明。
- `docs/adr/001-reading-content-domain-model.md`：Library 成员、Continue Reading 与 History/ReadingState 的领域约束。
- 实际调用点见下文 `apps/web/**`、`packages/shared/**` 与 backend route/service 文件。

## 2. 路由与 Admin Catalog

- 用户页面路径仍为 `/my-shelf`，route 文件 `apps/web/app/(app)/my-shelf/page.tsx` 现在挂载 `LibraryPage`（feature 路径 `apps/web/features/library/`）。这是保留的 URL/显示文案历史命名，不表示运行时仍使用 Shelf domain。
- Admin Catalog 当前页面路由为 `/admin/catalog/works`、`/admin/catalog/works/new`、`/admin/catalog/works/[id]` 及预览子路由；文件位于 `apps/web/app/admin/catalog/works/**/page.tsx`。`apps/web/constants/index.ts` 的 `ADMIN_ROUTES.works` 及相关 helper 指向新路径。
- Admin Web client `apps/web/features/admin/works/works-api.ts` 使用 `/api/admin/catalog/works` 及其 detail、EPUB、publish/unpublish、workflow 子路径；管理音频调用也使用 `/api/admin/catalog/works/...`。后台 route 在 `apps/backend/src/domains/works/routes/admin.ts`，音频 route 在 `apps/backend/src/domains/assets/routes/content-assets.ts`。
- 在 `apps/web` 与 `packages/shared` 的活跃 runtime 源码中，旧 endpoint `/api/admin/works` **0 个引用**；旧页面前缀 `/admin/works` 没有对应 route，也没有旧路径别名。feature 目录仍叫 `features/admin/works`，属于内部模块命名，不是旧 URL/API。
- 当前 runtime `/admin` 仍跳转到 `ADMIN_ROUTES.works`，即新的 Catalog 路由。

## 3. Library：当前 Route、API 与 Contract

### 事实

- 页面路径保留 `/my-shelf`，但实际页面使用 `LibraryPage`、`LibraryGrid`、`LibraryBookCard`、`LibraryContinueHero` 等 `features/library` 组件。
- Web client：`features/library/library-public.ts` 的 `getLibrary()` 使用 `GET /api/library`，并以 `@gloaming/shared/library` 的 `libraryDataSchema` 解析为 `LibraryData`。
- Shared contract：`packages/shared/src/library/library.ts` 定义 `LibraryItem`、`ContinueReadingItem`、`LibraryData`。`LibraryData` 当前响应形状是 `{ current, items }`；`items` 是 Library 成员，带可空 `ReadingState`。
- 成员读模型按“拥有的 Personal Work + 显式保存且可访问的 Catalog Work”组成；进度仅作为可选 state decoration。`/api/library` 的 backend route/service 位于 `apps/backend/src/domains/library/routes/index.ts`、`service.ts`。
- 活跃 Web/shared runtime 中旧 `/api/shelf` endpoint **0 个引用**，`ShelfData`、`packages/shared/shelf`、`features/shelf` 与旧 Shelf API 模块均不存在。仍可看到的 Shelf 仅是 `/my-shelf` URL、`shelf` nav/route 常量或本地化 key 等命名残留；按 **URL/component-copy naming only** 分类，不是旧 runtime domain。
- Admin Catalog 之外，用户 Library 内没有个人作品删除 UI；Personal Work 属于用户拥有的 Library item，但 PR-05 没有增加 Personal Work 删除 API。

### Add / Remove 与 UI consumer

- Add client：`features/library/library-api.ts` 的 `addToLibrary()` → `POST /api/library/:workId`。`useAddToLibraryMutation()` 位于 `library-client.ts`，实际 UI consumer 是作品详情页 `features/book-detail/book-detail-page.tsx` 的加入书架 CTA（桌面详情和移动 sticky CTA 共用 handler）。
- Remove client：同文件有 `removeFromLibrary()` → `DELETE /api/library/:workId`；但前端没有移除 mutation hook、按钮或调用点。按当前 Web feature 源码搜索，`removeFromLibrary` 唯一使用是其自身定义，故 **API client 方法存在，UI consumer 不存在**。
- Remove API 只删除显式 Catalog membership；不等同于删除用户拥有的 Personal Work。该差异在 PR-05 backend service 与 review 中明确。

## 4. Discover / Book Detail 的实际 API

| 前端功能 | 当前调用 | UI consumer / 说明 |
|---|---|---|
| Discover list | `GET /api/catalog/works?...` | `features/discover/discover-api.ts`，`DiscoverPage` / Discover grid |
| Taxonomy filters | `GET /api/catalog/categories`、`GET /api/catalog/tags` | 同一 API module 的 Query hooks |
| Discover saved status | `GET /api/library` | `fetchDiscoverCatalog()` 将 `LibraryData.items` 映射为 `available` / `in_library`；401 时按未登录无成员态处理 |
| Book detail work | `GET /api/catalog/works/:id` | `features/book-detail/book-detail-api.ts`；只取已发布 Catalog Work |
| Book detail parts | `GET /api/reader/works/:id/parts` | Reader parts public client |
| Book detail progress | `GET /api/reader/works/:id/state` | 与 Library membership 分开请求；401 时可无 state |
| Book detail saved status | `GET /api/library` | 通过成员 map 判断该 Catalog Work 是否已在 Library |
| Add to Library | `POST /api/library/:workId` | Book detail 页面实际有 UI；Discover 卡片源码没有独立 Add 操作 |
| Remove from Library | `DELETE /api/library/:workId` | API client helper 存在，当前没有 UI consumer |

因此，前端的 Saved state 来自 Library member query，不由“读过”推定。已存在详情页 Add flow；Remove endpoint 尚未接入 UI。

## 5. Continue Reading 与 Progress / History

- **当前前端请求来源：** Library 页面只调用 `useLibraryQuery()` → `GET /api/library`；Continue Hero 读取 `LibraryData.current`。当前没有单独的 Continue Reading 或 progress query 被 Library 页面调用。
- **字段来源：** backend `getLibrary()` 独立查询最新、可访问且 `in_progress` 的 `reading_state` + Work 作为 `current`，再独立查询 owned/saved membership 作为 `items`；current 可属于未显式保存的 Catalog Work。
- **领域解释：** PR-05 与 ADR 将 Library membership、Continue Reading progress projection、Reading History 规定为不同投影；History 页面另用 `GET /api/reading-history`，其 Query、页面和数据模型均独立。
- **传输层差别：** 领域/查询语义分离，但当前 API 将 `current` 和 `items` 聚合在同一个 `GET /api/library` 响应。故准确结论是：**Continue Reading 源自独立 ReadingState projection，但前端仍从 Library response 消费；不是独立的前端 API/query。** 这与 membership 不由 progress 定义相符，但响应体仍是聚合 transport；PR-05 review 已记录此选择/待检查响应体合并的问题。
- **现有 UI 的重要限制：** `LibraryContinueHero` 的 Continue 按钮直接进入 `/read/:workId`；普通 `LibraryBookCard` 点击封面/标题进入书籍详情 route，而 `BookDetailPage` 查询的是 Catalog-only `/api/catalog/works/:id`。因此 Personal Work 通用 Reader route/API 存在，但 Library 普通卡片目前不是 Personal Work 的直接 Reader 入口，且不能据此声称 Personal Work 详情 UI 已完成。

## 6. Personal Upload 与 Personal Work Read

- Backend `apps/backend/src/domains/works/routes/personal.ts` 已注册认证的 `POST /api/works`，创建个人 EPUB Work；PR-04 记录其 ingestion/read access 边界。
- 在 `apps/web` runtime 源码中没有 `/api/works` 调用、上传 client 或用户侧 Upload route/页面。Admin EPUB client 使用 `/api/admin/catalog/works/epub`，与 Personal endpoint 不同。
- 结论：Personal EPUB Upload = **Backend capability only；前端 API client 和 UI missing**。
- Personal Work read 的后端访问能力已存在。前端有通用 Reader 页面 `/read/[workId]` 与 `/api/reader/works/:id/parts`、`/api/reader/parts/:id` 等通用 client，Reader 不是 Catalog-only；但未发现 Personal Upload → Library item → Reader 的完整用户上传入口流程。Library item card 走 Catalog detail 的限制见第 5 节。因此“通用 Reader 可承载可读 Work”已存在，“Personal Work 完整用户浏览/打开路径”未完成。

## 7. User LLM / TTS Provider

PR-06 backend 已新增认证用户 API：

- LLM：`GET/POST /api/settings/llm/providers`、`PATCH/DELETE /api/settings/llm/providers/:id`、`GET/POST /api/settings/llm/models`、`PATCH/DELETE /api/settings/llm/models/:id`、`GET /api/settings/llm/settings`、`PUT /api/settings/llm/settings/:key`。
- TTS：`GET/PUT /api/settings/tts/config`。
- API 路由分别见 `apps/backend/src/domains/llm/config/user/routes.ts`、`apps/backend/src/domains/tts/routes/user-config.ts`。它们从认证 session 获取 user ID；PR-06 报告注明密钥只以设置状态/掩码返回，不回传明文。
- DTO 复用既有 shared LLM/TTS schema；PR-06 没有增加前端 User Provider API client、Settings UI 或用户侧 Provider form。
- 活跃 `apps/web` runtime 中没有 `/api/settings/llm/*`、`/api/settings/tts/*` 请求。已有 `features/admin/ai/ai-config-api.ts` 和 `features/admin/tts/tts-config-api.ts` 调用的是 `/api/admin/...`，属于系统管理配置，不是这些新用户 API 的 consumer。
- 结论：**Backend capability ready；shared DTO 可复用；frontend API client missing；UI consumer/Settings route missing。** 不设计设置页面或 Provider UI。

## 8. Current Frontend Truth Table

| Capability | Backend Ready | Frontend API Client Ready | UI Ready | Current Route | Current API | Notes |
|---|---|---|---|---|---|---|
| Library read | 是 | 是 | 是 | `/my-shelf`（挂载 LibraryPage） | `GET /api/library` | API 响应含 `items` 与 `current`；Personal Work 与 Saved Catalog 的来源/处理状态未作为显式字段暴露。 |
| Add to Library | 是 | 是 | 是 | Discover Book Detail | `POST /api/library/:workId` | 详情 CTA 已接入；不是 Discover 网格卡片 CTA。 |
| Remove from Library | 是 | 部分：delete helper 存在 | 否 | 无 | `DELETE /api/library/:workId` | 无 hook/UI consumer；仅删除显式 Catalog membership。 |
| Personal EPUB upload | 是 | 否 | 否 | 无用户上传 route | `POST /api/works` | Backend capability only；Admin 上传使用另一 endpoint。 |
| Personal Work read | 是 | 是（通用 Reader client） | 部分 | `/read/[workId]` | `/api/reader/works/:id/parts`、`/api/reader/parts/:id`、state API | Reader 可读可访问 Work；Library 普通卡片进入 Catalog-only Book Detail，完整个人作品入口链未就绪。 |
| Discover | 是 | 是 | 是 | `/discover` | `/api/catalog/works`、`/api/catalog/categories`、`/api/catalog/tags`、`GET /api/library` | Saved state 由 Library data 衍生。 |
| Continue Reading | 是 | 部分：随 Library query 读取 | 是 | `/my-shelf` | `GET /api/library` 的 `current` | 独立 progress projection；不是独立前端 endpoint/query。 |
| Reading History | 是 | 是 | 是 | `/reading-history` | `GET /api/reading-history` | 与 Library membership/Continue Reading 分别查询。 |
| User LLM Provider | 是（PR-06） | 否 | 否 | 无 Settings route | `/api/settings/llm/providers`、`models`、`settings` | 后端能力与 shared DTO；无 web client/UI consumer。 |
| User TTS Provider | 是（PR-06） | 否 | 否 | 无 Settings route | `/api/settings/tts/config` | 后端能力与既有 TTS DTO；无 web client/UI consumer。 |
| Admin Catalog | 是 | 是 | 是 | `/admin/catalog/works` | `/api/admin/catalog/works` | Admin 页面、API client、backend route 已迁移；旧 Admin Work 路径无兼容别名。 |

## 9. Remaining UI Work（事实）

- Backend ready，用户 UI/API client missing：Personal EPUB Upload。
- Backend ready，用户 UI/API client missing：User LLM Provider / model / purpose settings 和 User TTS config；现有 Admin Config 不是替代品。
- Backend 和前端 DELETE client ready，用户 UI missing：Remove from Library。
- 通用 Reader UI/client ready，但 Personal Work 的 Library 卡片仍去 Catalog-only detail；个人作品完整打开路径尚未贯通。
- Continue Reading 仍渲染，但由 `/api/library` 聚合响应中的 `current` 提供；Library 与 progress 在领域语义独立，前端 query/response 尚未独立。
- Admin Catalog 已采用新 `/admin/catalog/works` 与 `/api/admin/catalog/works` 路径；没有发现旧 API migration 需求。`features/admin/works` 是内部目录名。

## 10. 既有 Frontend Design Baseline 的事实增量

以下 **8 组事实项**应覆盖旧基线相应的业务事实；视觉、tokens、Reader、组件和响应式章节仍按旧基线保留：

1. Information Architecture / Routes：Admin 入口现在是 `/admin/catalog/works`，不是旧 `/admin/works`。
2. Shelf / Library：`/my-shelf` 保留，但内容由 `features/library` 和 `LibraryPage` 提供。
3. Shelf domain/API：`/api/shelf`、`ShelfData`、Shelf shared/Web runtime domain 已移除，当前是 `LibraryData` / `/api/library`。
4. Discover / Detail：作品数据仍来自 Catalog APIs；saved state 来自 Library；Detail 的 Add 已有 UI。
5. Add / Remove：Add 有 API client、hook 和 Detail UI；Remove 只有 API client helper，没有 UI consumer。
6. Continue Reading / History：`current` 来自独立进度投影但被放进 `/api/library` response；History 使用自己的 `/api/reading-history` query。
7. Personal Upload / Read：上传 backend `POST /api/works` 已就绪但没有用户端调用；通用 Reader 存在，Personal Work 从 Library 卡打开的路径有限。
8. Settings / Admin readiness：PR-06 User LLM/TTS APIs 已就绪但无前端 client/UI；Admin Catalog 已迁移到新路径。

这些是事实校正项，不是 UI 实施计划，也不决定未决产品问题。

## 11. 审计计数与限制

- PR-01～PR-06 基线：已确认。
- 旧 `/api/shelf` 活跃 `apps/web` + `packages/shared` runtime 引用：**0**。
- 旧 `/api/admin/works` 活跃 `apps/web` + `packages/shared` runtime 引用：**0**。
- 统计排除了 review/产品文档、测试/spec；目录/组件的 `shelf` 历史命名不当作旧 API runtime 引用。
- 只读源码审计；未启动 Web/backend，未做真实 UI 浏览或运行测试。
- Runtime code 修改：**No**。
