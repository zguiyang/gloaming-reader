# Review Gate #2 — PR-06 ～ PR-08 集成架构审查

## 1. 元数据

| 项目            | 记录                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| 阶段            | Review Gate #2；调查与静态架构审查                                                                              |
| 分支 / worktree | `codex/user-first-review-gate-02` / `/Users/joyzhao/.codex/worktrees/user-first-review-gate-02/gloaming-reader` |
| 审查 HEAD       | `6f68abeb6e10f4553583e7729f2dbbaac984fb6f`                                                                      |
| 审查范围        | PR-06 Provider Resolver、PR-07 Library / Personal Upload / Read Flow、PR-08 Settings / BYOK                     |
| 执行约束        | 只读审查；只改本目录审查文档；不调用 Cursor；不运行昂贵全量测试；不合并、不推送、不开始 PR-09                   |
| 人工批准        | Pending；本审查不代表产品负责人批准                                                                             |

## 2. 审查范围与口径

**已确认事实**来自当前 HEAD 的源码、schema、路由、共享契约和阶段审查记录。**审查判断**只对明确列出的候选/风险成立；不把目录命名、视觉相似或“架构更纯”当作减法证据。**未决决定**继续保留在 Decision Watchlist。本轮没有 runtime 修改，也没有重新运行测试套件。

## 3. Git 基线

当前分支从 PR-08 review commit 建立，工作树起始洁净。下列指定提交均是当前 HEAD 的祖先：

| 节点                             | Commit                                     | HEAD ancestry       |
| -------------------------------- | ------------------------------------------ | ------------------- |
| PR-06 implementation             | `b481a2fad4480f8d084d6e1a7fa7f6e96633db53` | 是                  |
| PR-06 review                     | `da5ede8b83673ec981459fea0091d8d9f5cdb279` | 是                  |
| Frontend audit checkpoint        | `bd0878ecdad664e406d7dd623915b9d7e44166cf` | 是                  |
| PR-07 implementation             | `af20840164a1f6ed315f1ea017375d36e19ff2d3` | 是                  |
| PR-07 review                     | `c043e73b0a9ac7fe28311dd2f11b35b0b1ab3bd7` | 是                  |
| PR-07 deferred visual acceptance | `7cef05b59c814a14e48821cec69ae060457dd9eb` | 是                  |
| PR-08 implementation             | `4f240d25fd0c7008c19e3e6f31cb88cba66ba803` | 是                  |
| PR-08 review                     | `6f68abeb6e10f4553583e7729f2dbbaac984fb6f` | 是，且等于审查 HEAD |

**基线结论：正确。** 当前源码确实包括 PR-04 / PR-05 的 Work、Catalog、Library 实现，以及 PR-06、PR-07、PR-08。未使用旧 `dev` checkout 代替指定基线。

## 4. 当前 User-first 架构

- `ReadingWork` 是唯一 Work 根；个人 Work 通过认证身份写入 `owner_user_id`，Catalog Work 由 Admin 管理并通过 `published_at` 发布。
- Personal EPUB 与 Catalog EPUB 共享摄取/解析核心；入口策略不同。Personal 创建私有、拥有者可读的 Work，不要求发布，不创建显式 Library 成员行。
- Library 是拥有的 Personal Works 与显式保存的 Catalog Works 的读取投影；`user_library_item` 只表示显式 Catalog 保存。
- `reading_state` 表示位置/进度；阅读历史 API 是独立投影。`Library ≠ Progress ≠ History` 仍成立。
- LLM 配置使用 `llm_provider`、`llm_model`、`llm_app_setting` 的 Instance/User 作用域；TTS 使用同表 `tts_config` 的 Instance/User 作用域。两个 provider 家族当前有不同配置形状和消费者。
- `/settings` 管理个人 LLM/TTS 设置；账户资料留在 `/account`。`/library` 已取代前端 `/my-shelf`。

## 5. 端到端链 A — Settings → Provider → Runtime

### LLM 链路

1. Web `/settings` 的 `settings-api.ts` 调用 `/api/settings/llm/providers`、`models`、`settings`；DTO 来自 `@gloaming/shared/llm`。
2. 用户端路由均有 `requireAuth`。服务以 session 用户 ID 查询/写入；Provider/Model 的跨用户操作由拥有者校验拒绝。Provider 请求体禁止 `ownerUserId` / `owner_user_id`。
3. `resolveModelRowId` 按 purpose 读取用户映射、再读取 Instance 映射。解析会验证 Model/Provider 是否启用、API family 是否受支持、wire variant 是否有效、归属是否匹配、密钥能否解密。不可用配置在发出 upstream 请求前跳过并尝试下一层。
4. `resolveLlmByModelRowId` 再通过已解析出的 Model row id 读取 Provider/Model 并解密密钥；这是 runtime 参数加载，不是业务调用方自行选择 Provider 的第二套解析策略。
5. Translate 与 Assist 明确传入当前用户 ID；Dictionary 的 AI enrichment 传入可用的用户 ID。上述调用进入统一 AI runtime。Admin 的 Provider 管理/连通性功能走 Admin API 与 Instance 范围。

**配置 fallback 与 runtime failure 分离：** 用户配置缺失、禁用、不可访问、API family 未实现或密钥无法解密时，可在调用开始前回退到可用 Instance 配置；两层都不可用才返回未配置错误。进入 LLM/TTS upstream 调用后，timeout、HTTP 500、额度错误等不会被 resolver 捕获并偷偷重试 Instance。源码未发现业务 runtime 直接从环境变量选择 LLM/TTS Provider；`process.env` 的代理环境读取位于网络适配边界，不用于 Provider 选择。

### LLM purpose 映射缺口

当前 UI 提供「阅读辅助」「翻译」「作品信息整理」用途配置。Metadata enrichment 的实际调用由 `metadata-enrich` 后台 Job 发起，`invokeMetadataAiEnrichment` 没有传 `userId`；该 Job 因而按 anonymous actor 解析，只能使用 Instance purpose mapping。Personal EPUB parse 当前直接进入 `ready`，没有用户侧 metadata-enrich Job。

因此用户配置 `metadata-enrich.default_model_id` 能被保存，但当前没有用户发起的 metadata runtime 消费者；后台 Catalog metadata enrichment 也不使用某位用户的 purpose mapping。这是可见配置与当前消费范围不完全对应的事实，尚不是主阅读闭环故障。不得把它描述为已验证可用的 User metadata BYOK。

### AI purpose 单项清除

Settings 当前没有清除单个 purpose mapping 的 API。切回「默认服务」时，前端并行停用所有个人 LLM Provider；各 purpose mapping 保留。再次启用个人 Provider 后，旧映射会重新生效。数据仍受 scope/access 校验，不会越权读取；但用户可能将“切回默认”理解为删除个人模型选择，之后重新启用时发生意外恢复。它是待产品/API 明确的 Deferred Product/API Gap，不构成 PR-09 前置 blocker。

另外，切换服务来源由前端对多个 Provider 发起并行 PATCH，没有服务端原子批量操作；任一 PATCH 失败可能留下部分 Provider 启用的中间态。此实现行为应在 Settings 集成验证中覆盖，不可宣称 mode 切换具备事务原子性。

### TTS 链路与发现

- `/settings` 有 GET/PUT `/api/settings/tts/config` client 和表单；Shared DTO 为 `@gloaming/shared/tts`。用户路由使用 `requireAuth`，服务按 session 用户 ID 读写。密钥加密存储，回包只含 `apiKeyMasked` / `apiKeySet`；保存时空密钥保留原密钥。
- `synthesizeTts` 统一调用 `resolveScopedTtsConfigRow`，它可按 user row → instance row 解析。生成音频的实际 Reader API 返回既有 `ContentAsset` 音轨；Catalog 音频生成任务是 Admin Work/Part 路由触发，队列输入没有 user ID，使用 Instance TTS 配置。
- 当前 Web Reader 只请求 `/api/reader/parts/:partId/audio` 读取已生成音轨；没有从 `/settings` 配置触发用户专属音频合成/生成的调用方。**用户 TTS 设置当前没有接入 Reader 的实际朗读播放链。**配置页面存在不等于用户自己的 TTS 已用于朗读。
- 同时，Admin `/api/admin/tts/test` 将 Admin 用户 ID 传给 `testTts`，后者传给 `synthesizeTts`；`runtimeActorFromUserId` 只区分 anonymous/authenticated，不区分 Admin actor。因此若 Admin 账户存在个人 TTS 行，测试请求会优先选该用户配置，不是 PR-06 审查记录所说的“Admin 测试固定 Instance”。这是当前源码与 PR-06 记录不一致的运行时作用域缺口；未发现跨用户读取，但会使 Instance TTS 连通性检查产生错误对象。

### Settings 真实用户文案

中文消息包含「设置」「服务来源」「默认服务」「使用自己的 API」；说明文字包括「保存后将停用个人 AI 配置，后续请求使用默认服务」「未设置个人模型的能力会使用默认服务」「后续朗读请求使用默认服务」。未发现向用户展示 `Instance Provider`、`User Provider`、`Resolver`、`owner_user_id` 等实现词。

## 6. 端到端链 B — Library → Upload → Reader

### Personal Upload → Reader

`/library` 调用 multipart `POST /api/works`；路由 `requireAuth` 并使用 session user ID。摄取包装创建 `origin_kind=user_epub`、`visibility=private`、`owner_user_id=session user` 的 Work 并排入共享解析。Personal parse 完成后可到 `ready`，不要求 Admin review、Catalog publish 或预先生成 TTS；Library 会在 `processing` 期间轮询，ready 项链接 `/read/:workId`。Reader 的 Work/Part 读取由现有 Work Access Policy 授权，Personal 所有者可以读取。

### Discover → Add → Library → Reader

- Discover 列表/分类/标签：`GET /api/catalog/works`、`/api/catalog/tags`、`/api/catalog/categories`。
- Discover 保存状态：前端调用 `/api/library` 并从 `items` 计算当前用户成员状态；匿名 401 时按未保存处理。
- Book Detail：`GET /api/catalog/works/:id`、`GET /api/library`、`GET /api/reader/works/:workId/parts`、独立 `GET /api/reader/works/:workId/state`。详情书目仍是 Catalog Work；Personal Work 从 Library 直接进入 Reader，不走 Catalog detail API。
- Add / Remove：分别为 `POST /api/library/:workId` 和 `DELETE /api/library/:workId`；后端只允许对当前公开 Catalog Work 增删显式成员行。移出不删 Work，不删除进度/历史。
- Reader：Work/Part API 与 reading state API 分离；打开 Work 不自动创建 `user_library_item`。`reading_state` 的读写不是 Library membership 写入。

### Continue Reading 与 History

`GET /api/library` 返回 `{ current, items }`。`current` 在 Library service 中由独立的 `reading_state` 查询投影（`status=in_progress`、按 `lastReadAt` 排序）；`items` 另由 owned Work 与显式 saved Catalog Work 两组查询拼成，进度是可空装饰。Continue Reading 的语义来自 Progress，不是 membership；当前共享传输将两种投影放在一个响应中，但源码未显示跨域写入或重复进度查询造成的已证实故障，因此不以“架构不纯”判为减法项。

阅读历史由 `/api/reading-history` 返回，查询使用 `reading_day`、reading state/完成数据及历史投影；schema 没有名为 `reading_history` 的单体事件表。历史 API 与 Library membership 不共用成员事实。PR05-HISTORY-001 的旧数据迁移影响见第 14 节。

## 7. Domain SSOT Matrix

| Domain              | SSOT                                                     | 当前实现                                              | 绕过 / 例外                                               | 状态                                       |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| Ownership           | `reading_work.owner_user_id`；用户归属来自认证 session   | Personal upload、Work Access Policy                   | 本轮未发现客户端可指定 owner                              | 稳定                                       |
| Access              | WorkReadActor / `workReadAccessSql`                      | Reader、Library 与内容读取调用共享策略                | Admin 另走受保护的管理入口                                | 稳定                                       |
| Publication         | `reading_work.published_at`                              | Catalog Work publish/unpublish lifecycle              | processing status 不表示发布                              | 稳定                                       |
| Ingest              | `reading_work` + `reading_part` + `content_asset`        | Personal 与 Catalog 包装共享 EPUB ingest/parser       | User Personal pipeline 无 Admin publish                   | 稳定                                       |
| Library             | 所有权并集 `user_library_item`                           | `/api/library` owned + explicitly saved projection    | 0036 历史 backfill 行来源不明                             | 当前运行时稳定；历史意图 Pending           |
| Reading Progress    | `reading_state`                                          | Reader state API；Library `current` 为只读 projection | `current` 与 `items` 共用响应 transport                   | 稳定；transport 可观察                     |
| Reading History     | `reading_day` 等历史查询投影                             | `/api/reading-history`、heartbeat                     | 无 `reading_history` 单表                                 | 稳定；旧 backfill 决策 Pending             |
| Provider Resolution | `owner_user_id` + purpose mapping，配置可用性校验        | `provider-scope`；统一 AI runtime                     | Admin TTS diagnostics 将 Admin ID 当作 user actor         | LLM 稳定；Admin/TTS actor scope 有 blocker |
| User Settings       | `llm_provider/model/app_setting`、`tts_config` User rows | `/api/settings/*` + `/settings`                       | Metadata purpose 无用户 actor consumer；TTS 未连接 Reader | TTS runtime consumer Pending               |

## 8. PR-06 审查

**稳定事实：** LLM 配置解析先检查配置可用性，再按用户配置与 Instance 配置选择；所有权检查由 session ID 驱动；用户端 API 有认证；密钥密文未由 UI/DTO 明文返回。Translate/Assist/Dictionary 路径进入共享 AI runtime。用户配置与 Admin 配置路由分离。

**差异 / 风险：** 直接 Provider/Model 数据读取主要集中于 `provider-scope` 与 `infra/llm/resolve.ts` runtime hydrate，以及各自配置管理服务；没有发现业务模块另建 user/instance resolver。TTS Admin 连通性测试的 user actor 行为与 PR-06 review 文档中的“Instance 固定”记录不符，应以当前源码为事实。完整后端全量测试并未通过，见第 16 节。

## 9. PR-07 审查

**稳定事实：** `/library` 已取代 `/my-shelf`；个人上传、异步状态、owned Work Reader 链路和 Catalog 显式保存/移除已连通。Reader 可读与 Library 成员资格是分离的。

**未决事实：** Personal Work 删除没有用户 API/UI。0036 历史回填继续把旧 `reading_state` 行转成成员行，新代码按新语义运行，但历史用户意图仍无法还原。FRONTEND-VISUAL-001 仍 Pending。

## 10. PR-08 审查

**稳定事实：** `/settings` 已有个人 LLM Provider/Model/purpose 表单及个人 Azure TTS 配置表单；LLM/TTS 设置有 Web API client；默认服务与使用个人 API 是面向用户的产品说法，账户资料仍在 `/account`。

**尚未闭环：** TTS 配置管理没有连接到 Reader 的 per-user playback/synthesis；当前预生成音频仍由 Catalog/Admin Instance 工作流生成。Metadata purpose 设置没有当前用户 runtime consumer。Provider mode 切换是多个 PATCH，不是原子服务端操作。FRONTEND-VISUAL-002 仍 Pending。

## 11. 跨阶段集成发现

| ID     | 事实                                                                                                 | 影响                                              | 归类                                                    |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| R2-001 | User TTS settings 可保存，但 Web Reader 仅获取已生成音轨；生成队列没有用户身份                       | 「使用自己的 API」不能改变当前 Reader 朗读来源    | Blocking before PR-09，先明确并闭合此链或明确其非目标   |
| R2-002 | Admin TTS test 把 Admin ID 传给按 user-first 解析的 runtime                                          | 有个人 TTS 配置的 Admin 会测个人配置而非 Instance | Blocking before PR-09；与 PR-06 已记录决策冲突          |
| R2-003 | Metadata purpose 可以配置，但后台 enrichment job 无 userId；Personal upload 不走 metadata enrichment | 当前设置对用户作品没有已证实 runtime 消费         | Deferred Product/API Gap / 决策关注项                   |
| R2-004 | 切换 LLM 服务模式并行调用多次 PATCH                                                                  | 中途失败可能留下部分 personal Provider 仍启用     | Integration validation；没有证据表明是严重数据/权限风险 |
| R2-005 | `/api/library` 汇总 `current` 与 `items`                                                             | transport 合并，查询与语义仍各自独立              | 目前未证明实际复杂度/错误依赖，不列减法候选             |

## 12. Security & Permission Review

- 用户 Provider、Model、Purpose Setting、TTS Config API 以 `requireAuth` 保护；受影响的用户数据由 session user ID 定界。
- Provider 创建/更新拒绝客户端 owner 字段；Model 可访问性通过其 Provider owner 判定。删除/更新针对拥有者行。
- User API 不调用 `/api/admin/llm/*` 或 `/api/admin/tts/*`；Admin 路由继续使用 `requireAdmin`。
- LLM/TTS 密钥在服务端加密；配置视图返回 masked key/set 标志。运行时解密仅在 server runtime。
- Work ownership 来自认证 session；Personal upload API 无 owner 字段输入。Reader Work Access Policy 与 Library 获取共同校验可读范围。
- **需处理的 actor scope 例外：** Admin TTS test 将 Admin 身份降格为一般 authenticated user actor；这会选取 Admin 自己的 TTS 配置。当前证据不是跨用户数据泄漏，但 Admin 的 Instance 配置验证语义不成立。
- 未发现 User Provider 被注入到 Admin LLM Config API 或客户端 `owner_user_id` 泄漏。

## 13. Product Decision Watchlist

| Decision ID          | 问题                                                    | 当前行为                                                                      | 用户影响                         | 技术影响                                     | 可否延期                        | 阻塞 PR-09 | 阻塞最终发布                      |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------- | ------------------------------- | ---------- | --------------------------------- |
| PR05-HISTORY-001     | 如何处理 0036 历史成员回填                              | 每条既有 state 行都回填成员，无法分辨主动保存/自动阅读                        | 旧书可能显得已主动保存           | 无可靠来源字段用于选择性分类                 | 可延至数据决策阶段              | 否         | 是（先定迁移数据处理）            |
| PR04-PRODUCT-001     | 重复上传同一 EPUB 的产品身份                            | 对象字节可复用，仍创建新 Work                                                 | 可能出现重复书目、独立进度       | 改为去重 Work 会改变身份/进度边界            | 可                              | 否         | 否                                |
| PR03-PRODUCT-002     | Catalog 未发布/取消发布时保留保存行的意义               | 保存成员行保留；未发布时 Library 隐藏，重新发布后再出现                       | 用户保存意图暂时不可见           | 需决定是否隐藏、删除或提示                   | 可                              | 否         | 否                                |
| PR05-PRODUCT-004     | Personal 拥有与 Catalog 保存是否需要显式分组/来源标签   | 当前合并列表以 `canRemoveFromLibrary` 间接区分；DTO 未提供完整来源 enum       | 来源含义不够直接                 | 不宜由前端名称推断域身份                     | 可                              | 否         | 否                                |
| PR05-PRODUCT-006     | Personal Work 删除语义                                  | 无用户删除端点/UI；Catalog remove 只删 membership                             | 用户不能删除自己的上传           | 涉及 DB、对象存储、进度/会话保留政策         | 产品决定 + backend 设计         | 否         | 待产品决定                        |
| PR05-PRODUCT-009     | 如何说明 0036 历史项来源                                | 迁移项与显式保存项表现一致                                                    | 用户可能把旧阅读误认为主动保存   | 需有来源标签或说明策略                       | 可                              | 否         | 若有迁移用户，需先定告知策略      |
| PR05-PRODUCT-010     | Library 顺序与容量策略                                  | merged list 上限当前为 48；owned 按 Work 创建时间，saved 按成员创建时间       | 超限时条目不展示，排序含义不显式 | 固定限制是共享契约                           | 可                              | 否         | 否                                |
| PR05-PRODUCT-011     | Catalog Admin 文案/操作流程                             | Admin Catalog 路由已迁移；当前审查未做运营流程复验                            | 运营人员使用的术语待确认         | 需结合完整 Admin runtime 评估                | Integration Branch 可验证       | 否         | 否                                |
| PR08-AI-RESET-001    | 默认服务切换是否清除单项用途映射                        | 停用所有个人 Provider，保留 purpose mapping；重新启用后恢复                   | 用户可能遇到旧选择意外复活       | 当前无单项清除 API；多 PATCH 非原子          | 产品/API gap 可延期             | 否         | 否                                |
| PR08-AI-METADATA-001 | 用户能否为自己的作品使用 Metadata purpose BYOK          | 映射可保存，但后台 Job 没有用户 actor；Personal upload 当前跳过 AI enrichment | 配置项当前对个人作品无实际效果   | 需要明确 Job 的 actor/产品范围               | 可                              | 否         | 若保留个人 Metadata BYOK 承诺则是 |
| PR08-TTS-RUNTIME-001 | 自己的 TTS 是否必须用于 Reader 朗读                     | 设置可保存，但 Reader 获取预生成音频且无用户配置合成 consumer                 | 用户设置后朗读来源不变           | 现有生成队列为 Admin Catalog/Instance 作用域 | 否；须先定范围与链路            | **是**     | 若保留个人 TTS 设置则是           |
| PR08-TTS-ADMIN-001   | Admin TTS probe 应固定 Instance 还是使用 Admin 私人配置 | 当前传 Admin userId，resolver 先选该用户配置                                  | 管理员可能测错目标配置           | 与 PR-06 review 记录相反                     | 否；须校正 actor 语义并覆盖验证 | **是**     | 否（管理诊断工具）                |

### 用户优先阶段中 AI 选择的来源

| 选择                                                      | 来源分类                                                       | 审查记录                                               |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| User → Instance → unavailable 的解析次序                  | Explicit Product Decision / PR-06 task contract                | 配置可用性阶段 fallback；upstream failure 不 fallback  |
| User Provider/Model 与 Instance 共用表，通过 owner 列分界 | Existing Project Convention / Accepted architecture            | `owner_user_id`，不另建 user 专表                      |
| User Config 放在 `/api/settings/*`                        | AI Implementation Choice（被后续 PR-08 消费）                  | 当前已有前端消费者，但 metadata/TTS runtime 边界未闭合 |
| `/settings` 页面与 AI/TTS 表单分区                        | AI Implementation Choice                                       | 只需人工 UX 验收；不单独成为 PR-09 减法目标            |
| 显式保存，不自动保存                                      | Existing Project Convention / PR-08 implementation choice      | 表单通过明确保存变更；visual Pending                   |
| 切回默认时 disable-all，但不删 mappings                   | AI Implementation Choice                                       | 已列 PR08-AI-RESET-001                                 |
| Library 上传反馈与 polling                                | Explicit PR-07 scope + Existing Project Convention             | 当前已实现，visual Pending                             |
| `/library` 路由                                           | Explicit Product Decision（用户将旧 Shelf 语义迁移到 Library） | 旧活动路由已删除，无兼容 alias                         |
| 读 Work 不自动加入 Library                                | Explicit Domain Decision                                       | 当前 Reader state mutation 不写 `user_library_item`    |

## 14. 历史迁移、删除依赖与 Integration 延期

### PR05-HISTORY-001

仍为 Pending。迁移 0036 是旧 `reading_state` → `user_library_item` 全量回填；本轮没有发现 PR-06～PR-08 新增对该来源假设的依赖。当前 `/api/library` 按 membership/ownership 读取，进度 left join；因此新代码尊重分离后的 SSOT，但历史回填行可能把曾自动打开/阅读的书表示成已保存，影响迁移用户的 Library 内容。Gate #2 不决定保留、删除或恢复。

### Personal Work Deletion Dependency Map

| 实体/资源                       | 当前真实关系                                                                                                                                          | 删除影响/外部工作                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `reading_work`                  | 根 Work；`owner_user_id` 对 User FK 为 `SET NULL`                                                                                                     | 删除 Work 是用户所有权控制；不能直接沿用只接受 Catalog 的 Admin `deleteWork` |
| `reading_part`                  | `work_id` → Work `ON DELETE CASCADE`                                                                                                                  | 行会级联删除；读取其 ID 以清理外部翻译缓存                                   |
| `content_asset`                 | `work_id` → Work、`part_id` → Part，均 `ON DELETE CASCADE`                                                                                            | DB 行删除不等于 R2/对象存储删除；需先收集 key 并用引用检查处理共享对象       |
| Origin EPUB / `uploaded_object` | origin_file 通过 storage key + ref_count 管理复用引用                                                                                                 | 需在事务内递减/删除引用，再做事务外存储清理；不能误删其他 Work 共用对象      |
| Audio / derived assets          | ContentAsset kind、meta 中可能含音频 key/对象 key；音频有兼容 key 收集 helper                                                                         | DB cascade 不执行对象存储与旧 key 清理；失败依赖 asset orphan 扫描恢复       |
| `user_library_item`             | Work FK `ON DELETE CASCADE`                                                                                                                           | 成员行随 Work 删除；个人 Work 正常不需显式 Catalog membership                |
| `reading_state`                 | Work FK `ON DELETE CASCADE`；`current_part_id` 对 Part 为 `SET NULL`                                                                                  | 该 Work 的进度一并消失；是否保留阅读状态是产品决定                           |
| 阅读历史                        | `reading_day` 是 user/day 聚合，无 Work FK；history API 另由 state/completion 等数据投影                                                              | daily activity 不会按 Work FK 删除；完成/书目历史呈现是否留痕需定义          |
| Conversation / Message          | Conversation 的 `subject_id` 是 polymorphic 文本且无 Work FK；`deleteWork` 手动删 `subject_type=reading_work` 的会话；Message 对 Conversation cascade | 若不执行会话清理会留下孤儿 Work 对话；消息随会话删                           |
| TTS/AI invocation logs          | 日志保存 user/work/part 文本 ID，但无 Work 外键                                                                                                       | DB cascade 不删除运行审计记录；保留期/个人删除合规需决策                     |
| bilingual/Redis cache           | Work 删除命令收集 Part IDs 并调用既有 bilingual cache 清理                                                                                            | 外部缓存清理需在事务后执行并处理失败                                         |
| Taxonomy associations           | Work-Tag/Category/Source join rows 对 Work cascade                                                                                                    | 标签/分类维度行是共享维度，不应因单一 Work 删除而级联掉共享实体              |

现有 `apps/backend/src/application/commands/delete-work.ts` 是 Catalog-only 删除命令：拒绝 Personal Work，且已发布 Catalog Work 要先 unpublish。它实现事务删除、上传文件引用计数、对象存储与缓存清理的两阶段路径，可作为依赖地图证据；不能据此假定 Personal 删除政策已经确定或直接复用。归类：**Product Decision Required + Backend Design Required**；之后是否进入 PR-09 或 Final Closeout 由实现边界决定，本轮不设计/实现。

### Visual Acceptance

| 项目                                        | 状态    | 触发条件                                          |
| ------------------------------------------- | ------- | ------------------------------------------------- |
| FRONTEND-VISUAL-001 — PR-07 Library         | Pending | User-first 统一 Integration Branch + 完整运行环境 |
| FRONTEND-VISUAL-002 — PR-08 Settings / BYOK | Pending | User-first 统一 Integration Branch + 完整运行环境 |

源码审查不是视觉审批。FRONTEND-VISUAL-001/002 与人工 PR-06～PR-08 review 均未关闭。

## 15. 数据库、API 与前端减法审计

### 数据库表边界

| 表 / 实体                               | 生命周期 / cardinality / 权限 / 查询                             | 合并判断                                                           |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `reading_work`                          | Work 身份、所有者/可见性/发布生命周期；每个 Work 一个根          | 独立 SSOT，不合并                                                  |
| `user_library_item`                     | User×Catalog Work 唯一显式成员；用户可增删                       | 独立关系与授权，不能并入 progress                                  |
| `reading_state`                         | User×Work 唯一、持续更新位置/状态                                | 独立写频率与冲突控制，不能并入成员行                               |
| `reading_day` / history projection      | User×本地日期聚合；heartbeat 写入，历史 API 查询                 | 不等同于 Work membership 或 progress row                           |
| `llm_provider`                          | Instance/User 可多 Provider；密钥、API family、启用状态          | 独立连接配置                                                       |
| `llm_model`                             | 每 Provider 多 Model，可独立启停/排序                            | 有真实 1:N cardinality，不能并入 Provider 字段                     |
| `llm_app_setting`                       | scope×purpose 到 Model 的映射                                    | 生命周期及唯一键独立于 Provider/Model                              |
| `tts_config`                            | 每 Instance/User 至多一行 Azure 区域、密钥与声音设置             | 与多 Provider/Model/purpose 模型不同；不能因都叫 Provider 自动并表 |
| `content_asset`                         | Work/Part 下多个各类资产；generation lease/key 与对象存储关联    | 独立资产生命周期、外部存储与幂等生成                               |
| `conversation` / `conversation_message` | 每个会话多条 append-only message；消息级创建/状态                | 对话生命周期与消息流生命周期不同；Message cascade 是有意的         |
| `article_audio`                         | 无活动表/实体；Admin log formatter 有 `admin.article_audio` 标签 | 合法的旧审计事件显示名，不是旧音频存储/runtime domain              |

**Fewer tables ≠ Better architecture。** 上述行具有不同生命周期、cardinality、权限或 query pattern。没有足够证据建议数据库合表。

### API / 前端边界

- `/api/library` 由同一 Library owner 提供 GET / explicit POST / explicit DELETE；没有旧 Shelf alias。
- `/api/works` 是 Personal EPUB 创建入口；`/api/catalog/*` 是公开 Catalog 查询；`/api/reader/*` 是可读 Work/Part 与 state/audio 读取；职责与认证不同。
- `/api/settings/llm/*` 与 `/api/settings/tts/config` 是用户设置；Admin 管理接口独立并受 Admin auth。没有发现旧 `/api/admin/works` runtime route。
- Library Card、Discover Card 与 Book Detail 面向不同状态/动作；当前未发现只因视觉相似就应合并的证据。不能把几种场景强行抽成一个通用卡片。
- Settings 表单和 Admin Config 的角色、认证、scope 不同；没有重复 API helper 应合并的证据。

## 16. 测试 / Verification Matrix

以下来自各阶段已记录结果；本轮只读，没有执行测试套件。

| PR             | Targeted Tests                                     | Shared Tests                  | Web Full Suite                | Backend Full Suite                                         | Repository Full Suite | E2E     | Visual Runtime |
| -------------- | -------------------------------------------------- | ----------------------------- | ----------------------------- | ---------------------------------------------------------- | --------------------- | ------- | -------------- |
| PR-06          | Passed — 11/11 后端目标测试                        | Not Run                       | Not Run                       | Blocked by Environment — 297 passed / 6 failed / 1 skipped | Not Run               | Not Run | Deferred       |
| PR-07          | Passed — Web 64/64、Backend Library functional 3/3 | Passed — Library contract 3/3 | Not Run                       | Not Run                                                    | Not Run               | Not Run | Deferred       |
| PR-08          | Passed — Settings API 4/4                          | Not Run（本 PR 未改 Shared）  | Passed — 48 files / 245 tests | Not Run                                                    | Not Run               | Not Run | Deferred       |
| Review Gate #2 | Not Run — docs-only audit                          | Not Run                       | Not Run                       | Not Run                                                    | Not Run               | Not Run | Deferred       |

“Passed”只指列明的目标范围；不得写成完整 Repository Regression Passed。最终集成仍需 Full Web、Full Backend、Repository、E2E 与视觉验收。

## 17. Environment / Tooling Issues

- PR-06 后端全量套件由测试命令范围错误触发；记录结果为 88 个文件中 42 个通过、46 个失败，304 个测试中 297 passed / 6 failed / 1 skipped。失败原因是环境缺少 `RESEND_API_KEY`，全量套件未通过，不能记作 Full Backend Regression Passed。
- PR-08 首次从仓库根执行 Vitest 导致 Web Vitest glob 跨 workspace 收集；`@/...` 后端别名解析失败。该次 202 个测试文件中 116 通过、86 失败，6 failed / 748 passed；不作为正式 Web 或全仓套件结果。之后正确 Web root 的 48 文件 / 245 测试通过。
- PR-08 隔离 worktree 的依赖安装尝试在 Node 26 下构建 `nodejieba` 失败；随后使用现有本地工具完成已记录的验证。没有 manifest/lockfile 修改。
- Review Gate #2 没有重新跑昂贵全量测试、E2E 或视觉运行；最终 Integration Branch 必须用正确 workspace/env/toolchain 补验。

## 18. Legacy Audit

搜索范围为当前 runtime 源码（`apps/backend/src`、`apps/web/app`、`apps/web/features`、`packages/shared/src`、`packages/db/src`）；测试、迁移、历史文档单独分类，不把其命中当 runtime。

| 搜索项                                           | Active Runtime 结果                                                                   | 分类与说明                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/my-shelf`                                      | 0                                                                                     | 旧路由只在“路由不存在”测试中出现；非 runtime                                                       |
| `/api/shelf` / `ShelfData` / `features/shelf`    | 0                                                                                     | 旧 API/DTO/Feature 已移除                                                                          |
| `/api/admin/works`                               | 0                                                                                     | 当前 Admin Catalog route 使用 `/api/admin/catalog/works`                                           |
| `/admin/works` 路由字面量                        | 0                                                                                     | Web route 为 `/admin/catalog/works`；28 个粗略子串命中来自合法 `features/admin/works` 目录/导入    |
| `requirePublished*`                              | 0                                                                                     | 旧通用访问 gate 已由 readable access policy 替代                                                   |
| `reading_work.status=published/tts` 等旧混合状态 | 活动 schema 使用 `processing_status` + `published_at`；`tts` 只作为独立 workflow step | 旧值只在迁移验证/历史材料中出现；不是活动 Work 状态                                                |
| `getPublished*`                                  | 1 个 helper 符号                                                                      | Book Detail 的 `getPublishedWork` 调用 Catalog detail API，属当前 Catalog 命名，不是旧发布 runtime |
| `shelf_profile` / `shelfWorks` / `shelf/genre`   | 有命中                                                                                | 推荐算法内部画像与 metadata 词汇，不是旧 Shelf API、route 或成员域                                 |
| `article_audio`                                  | 无活动表/实体；Admin log formatter 有 `admin.article_audio` 标签                      | 合法的旧审计事件显示名，不是旧音频存储/runtime domain                                              |
| global/default/first-enabled Provider 模式       | 未发现业务绕过 resolver 的读取                                                        | 管理配置服务、runtime hydrate 和配置管理 DB 查询不是绕过                                           |
| Provider/模型选择的直接 `process.env`            | 0                                                                                     | Infra proxy 环境变量读取与 Provider 选择无关                                                       |
| `cloud` / `selfHosted` 旧架构选项                | 0                                                                                     | 活动前端/后端/shared/db 源码未发现                                                                 |

### 非 runtime 命中分类

| 分类                       | 当前发现                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active Runtime             | 旧 Shelf 路由/API/DTO/Feature、旧 Admin 路由、`requirePublished*`、旧混合 Work 状态均为 0；新路径/SSOT 见上表                                     |
| Test                       | Library / Personal upload functional tests 请求旧 API 并断言 404；Web nav test 确认 `/my-shelf` route 不存在                                      |
| Migration                  | migration 0036 是保留的历史 backfill；旧 `reading_work.status` 值出现在迁移验证上下文，不是当前 schema 字段                                       |
| Historical Docs            | `frontend-design-baseline.md` 与较早产品/E2E 记录仍描述其生成时的 `/my-shelf`、`/api/shelf`、`/api/admin/works`                                   |
| Review Docs                | PR-01～PR-06 和早期 frontend delta 保留各自检查点快照；按历史记录阅读，不覆盖本 Gate 的 current truth                                             |
| Legitimate Internal Naming | `features/admin/works`、`domains/works/admin`、`shelf_profile` / `shelfWorks`、Catalog helper `getPublishedWork`、`admin.article_audio` log label |

视觉基线文档的 Visual Language / Tokens / Reader / Components / Responsive 仍按原用途有效；其中业务路由/API 表格属于较早快照，当前路由事实以本审查和后续经人工确认的增量记录为准。本轮没有重写该基线。

Admin Catalog 的真实文件包括 `apps/web/app/admin/catalog/works/**`、`apps/web/features/admin/works/**`、`apps/backend/src/domains/works/routes/admin.ts` 和 `apps/backend/src/domains/works/routes/catalog.ts`。`features/admin/works`、`domains/works/admin` 是合法内部组织命名；URL/模块名不等于旧 `/admin/works` runtime。

## 19. Architecture Growth Audit（PR-06～PR-08 implementation commits）

计数口径：仅统计三个 implementation commits 的运行时代码路径；测试、审查文档、配置与已有文件修改不计为新增 production file。Git rename 按路径变更单独说明。

| 类型                         |                                            变更量 | 说明                                                                                                                     |
| ---------------------------- | ------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------ |
| 新增 production source paths |                                                13 | PR-06 新增 8 个后端源码文件；PR-07 新增 `/library` route path（rename）；PR-08 新增 4 个 Settings 源码路径               |
| 删除 production source paths |                                                 1 | PR-07 将 `/my-shelf/page.tsx` 改名为 `/library/page.tsx`；不是留兼容 shell                                               |
| 新增 / 删除生产静态资源路径  |                                           +1 / -1 | `shelf.jpg` 改名为 `library.jpg`，不计入上行源码数                                                                       |
| 新增 Services                |                                                 2 | LLM user config service、TTS user config service                                                                         |
| 新增 Repositories            |                                                 0 | 直接复用现有 DB 层与 Drizzle 表                                                                                          |
| 新增 Resolver / helper files |                                                 4 | provider-scope access/index/resolution/types；其中职责为 scope/access/selection，而非多套 resolver                       |
| 新增 backend route handlers  | 12 HTTP method bindings / 7 LLM+TTS path patterns | user LLM Provider/Model/Settings CRUD 与 TTS config GET/PUT                                                              |
| 新增 Web route               |                                                 1 | `/settings`；PR-07 是 `/my-shelf` → `/library` route rename                                                              |
| 新增 Shared contract files   |                                                 0 | PR-07 修改既有 Library contract；PR-06/08 未新增 shared module                                                           |
| 新增 frontend source paths   |                                                 5 | PR-07 Library route rename + PR-08 Settings API、Settings page、TTS section、App Router page；其中 3 个 Feature 实现文件 |

引入的长期抽象有清楚的作用域解析与访问边界；目前未确认单纯 pass-through repository 或重复 Provider schema。唯一实际结构候选是既有后端 import-cycle component，见第 20 节。数量本身不构成减法依据。

## 20. Complexity Audit 与 Architecture Subtraction Candidates

### 静态 import cycle

PR-07 记录的 GitNexus 检查为 **1 个组件、32 条枚举环**。该工具可见索引停在 PR-06/PR-07 较早 commit，不是本轮 HEAD，因此不将其当作当前图结论。本轮对当前 `apps/backend/src` TypeScript 相对路径与 `@/` 静态 import/export 进行源代码 SCC 扫描：仍发现一个活动生产 SCC，包含 30 个文件。此扫描不解析动态 import、运行时别名以外的包依赖；结论由列出的静态源码边支持。

涉及文件：

- `apps/backend/src/application/commands/run-content-parse-workflow.ts`
- `apps/backend/src/application/jobs/content-parse.ts`
- `apps/backend/src/application/jobs/metadata-enrich.ts`
- `apps/backend/src/application/jobs/work-metadata-fill.ts`
- `apps/backend/src/domains/assets/content/part-audio-track.ts`
- `apps/backend/src/domains/assets/gateway/service.ts`
- `apps/backend/src/domains/assets/index.ts`
- `apps/backend/src/domains/assets/routes/assets.ts`
- `apps/backend/src/domains/assets/routes/content-assets.ts`
- `apps/backend/src/domains/ingest/epub/work-upload.ts`
- `apps/backend/src/domains/ingest/parser/index.ts`
- `apps/backend/src/domains/ingest/parser/service.ts`
- `apps/backend/src/domains/ingest/reset/index.ts`
- `apps/backend/src/domains/ingest/reset/service.ts`
- `apps/backend/src/domains/reading/history/index.ts`
- `apps/backend/src/domains/reading/history/query.ts`
- `apps/backend/src/domains/reading/index.ts`
- `apps/backend/src/domains/reading/reader/index.ts`
- `apps/backend/src/domains/reading/reader/service.ts`
- `apps/backend/src/domains/reading/reader/state-mutations.ts`
- `apps/backend/src/domains/reading/routes/history.ts`
- `apps/backend/src/domains/reading/routes/history/user.ts`
- `apps/backend/src/domains/reading/routes/index.ts`
- `apps/backend/src/domains/reading/routes/reader.ts`
- `apps/backend/src/domains/works/access/index.ts`
- `apps/backend/src/domains/works/access/policy.ts`
- `apps/backend/src/domains/works/admin/admin-work-write.ts`
- `apps/backend/src/domains/works/admin/catalog-epub-ingest.ts`
- `apps/backend/src/domains/works/admin/index.ts`
- `apps/backend/src/domains/works/read-model/stats.ts`

该组件属于**生产 runtime**，涉及 ingest、jobs、assets、reading、works access/admin；与 Library/User Settings 表单主链不直接等同，但会影响用户上传、Reader 内容访问、音频资产和历史服务的模块初始化/依赖维护。PR-07 没有改其所列文件；当前静态扫描显示组件仍存在。维护成本是真实的跨域循环，不代表有 32 个独立 bug。现有定向测试覆盖其中部分 capability；目前没有证据显示循环本身已导致测试失败。PR-07/08 未跑完整后端套件，故对完整测试影响标记为未验证。

| Candidate                 | Files / Symbols                                                                                                                                                        | 当前职责                                              | Callers                                        | 可能冗余点                                                                 | 删除会失去什么                                               | Risk                 | Evidence                                                                | PR-09 适合度                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 拆解后端 import-cycle SCC | 上述 30 个文件；重点 barrel：`assets/index.ts`、`reading/index.ts`、`works/access/index.ts`、`works/admin/index.ts`、`ingest/parser/index.ts`、`ingest/reset/index.ts` | 组合 Assets、Reading、Work access、Ingest 与异步 Jobs | 多个 runtime route、queue job、domain services | barrel 交叉导出让低层/高层能力相互初始化；不是单纯 one-call wrapper 的证据 | 若盲删 barrel 会失去稳定导出和流程连接；需改为清晰的依赖方向 | 高；涉及真实生产流程 | 当前源码 SCC 扫描；PR-07 先前检测有 1 component/32 cycles；影响路径已列 | 可作为 PR-09 调查候选，必须先给出最小割边计划及目标行为/测试；不可批量删除 |

**没有其他已证实的 subtraction candidate。** `/api/library` 聚合两个独立 read projection 但未发现错误写耦合；`llm_provider` 与 `tts_config` 的 cardinality/配置形状不同；Library/Discover 卡片与 Settings/Admin 表单场景不同。不开“少表/少文件”目标。

## 21. Protected Areas

即使后续 PR-09 获准，默认保护：

- Settings、Library、Discover、Book Detail 与 Reader 用户可见结构/行为。
- Provider 解析顺序、配置可用性判断、上游失败语义、User/Instance scope，以及 TTS actor scope（当前 blocker 修正前不可抽象/合并）。
- Work Access Policy、Publication 语义、Library membership、ReadingState 与 History 分界。
- Personal upload 的认证归属、ready/read 路径及对象共享计数。
- 当前 Integrations 的 visual acceptance 与 full suite 不得由 source-only review 关闭。

## 22. Blocking Findings

1. **User TTS runtime 消费链未闭合。** User settings/config API 可以保存，但 Reader 只使用预生成音频，Catalog 生成任务无 User scope，当前没有用户 TTS 的 Reader consumer。应先确认「使用自己的 TTS」是否承诺影响用户朗读；若是，链路/权限尚未完成；若不是，需记录明确产品范围。
2. **Admin TTS 连通性测试作用域和已接受记录冲突。** 当前路由将 Admin ID 当作 user actor 送入 user-first resolver；存在个人 TTS 行时会测试私人配置，而不是 Instance 配置。先明确 actor/scope 并恢复 Admin Instance 语义，不能依据 PR-06 文档摘要假定代码已经固定 Instance。

这些不是测试/视觉未做造成的 blocker，而是当前源码可观察到的 TTS 运行时边界问题。其余未决项没有被升级为 blocker。

## 23. PR-09 Readiness

**Can PR-09 Architecture Subtraction start: No（按当前提案的全范围审查门禁）。**

Exact blockers 是第 22 节的两个 TTS 项。视觉验收本身不阻止纯内部减法：cycle candidate 可在未来只做隔离的后端依赖方向整理，不需等待 Library/Settings visual acceptance；但它触及生产 ingest/assets/Reader 导入图，必须有最小改动边界和目标后端验证，并避免触碰尚未厘清的 TTS resolver/actor 语义。PR-09 应先解决/缩小这两个 blocker，再决定其可执行子范围。

此结论不启动 PR-09，也不授权本轮 runtime 修复。当前仅允许记录、交接和人工决策。

## 24. Maintainer Handoff

- User-first 内容根是 `ReadingWork`；Personal EPUB 经认证 `POST /api/works` 写入私有所有者 Work，共用 EPUB parser，解析后可 ready，再从 `/library` 打开 `/read/:workId`。
- Catalog Work 从 Discover 浏览；用户显式调用 `/api/library/:workId` 保存，Library membership 不由阅读产生。
- Library membership 是 owned Personal Work + saved Catalog Work；`reading_state` 是可选进度；Continue Reading 是 state projection；Reading History 通过独立 history API / daily aggregate 展示。
- AI 设置存在个人 Provider / Model / purpose mapping；每次 LLM runtime 请求按用户 scope 解析，用户配置不可用时才在调用前尝试 Instance。上游故障不静默换 Provider。
- TTS 配置表单/API 存在，但当前 Reader 使用预生成资产；Personal TTS 没有有效 Reader runtime consumer。Admin TTS probe 还有 actor scope 不符问题。
- 未验收项：FRONTEND-VISUAL-001/002 Pending、PR-06 Backend Full Suite Blocked by Environment、PR-07/08/Repository Full Suites 与 E2E Not Run、人工评审 Pending。
- 不能忘：PR05-HISTORY-001、Personal Work Delete、AI 单项 mapping reset、metadata purpose 无 user consumer、两个 TTS blocker、现有 backend import cycle。
- 未来 PR-09 仅可经新的明确 review 范围减低内部复杂度；不得借机重做 Settings/Library/Reader 产品行为或改变权限/解析语义。cycle SCC 是候选，不是授权。

## 25. Final Review Gate Status

| 分类                                 | 当前结论                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stable                               | Ownership、Work Access、Publication、共享 EPUB ingest 主体、Library membership、Reader state 与 History 分离、LLM user/instance 解析顺序与密钥隐藏                             |
| Deferred                             | FRONTEND-VISUAL-001/002；完整 Web/Backend/Repository regression；E2E；Personal Work Delete 产品/后端设计；PR05-HISTORY-001；AI purpose reset 与 metadata purpose consumer 决定 |
| Blocking                             | User TTS 设置到 Reader runtime 未闭环；Admin TTS test 的 actor scope 与 Instance-only 语义不符                                                                                 |
| Human Review                         | Pending                                                                                                                                                                        |
| PR-09                                | 暂不可开始全范围 Architecture Subtraction；先处理上述 TTS blockers，再重新限定允许减法范围                                                                                     |
| Runtime code modified in this review | No                                                                                                                                                                             |
