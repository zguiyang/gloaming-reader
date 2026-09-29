# PR-09 — TTS 用户作用域闭环 / Admin Instance 隔离

## 1. 元数据

| 项目              | 记录                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| 阶段              | PR-09 — TTS User Scope Closure / Admin Instance Isolation                                  |
| 分支              | `codex/user-first-pr09-tts-scope-closure`                                                  |
| Worktree          | `/Users/joyzhao/.codex/worktrees/user-first-pr09-tts-scope-closure/gloaming-reader`        |
| 基线              | Review Gate #2 `f1cb8de487a0d819904e33ac3692b75718275077`                                  |
| 实现提交          | `d49aa72024253de2fc21a4d48b26e7374c965f7d` (`fix(tts): isolate admin instance TTS checks`) |
| 审查提交          | 见后续 Git 历史                                                                            |
| 状态              | Admin Instance 隔离已实现；User TTS runtime 受共享音频资产模型阻塞；人工评审待完成         |
| Push / Merge / PR | 均未执行                                                                                   |

## 2. PR-09 的目的

分别复核 Review Gate #2 的 User TTS 与 Admin TTS 两项发现。调查先于实现。当前资产模型不能安全表达用户专属 TTS，因此本阶段只明确并加固 Admin TTS 连通性测试的 Instance-only 作用域，不把 `userId` 塞进共享音频任务，也不实现 Lazy TTS。

## 3. Review Gate #2 阻塞项

| ID       | 原发现                                                                         | PR-09 结论                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R2-001` | User TTS Settings 可保存，但 Reader 使用预生成音轨，没有用户专属合成消费者。   | **仍阻塞。** 共享资产、存储和缓存身份不包含用户/配置作用域，User TTS 与当前音轨模型冲突。                                                                                                                              |
| `R2-002` | Admin TTS test 将 Admin ID 传入 user-first resolver，可能选中 Admin 个人配置。 | 基线源码中 `testTts` 实际调用 `synthesizeTts` 时没有传 `userId`，已有测试已验证个人/Instance 配置并存时选中 Instance。PR-09 将该隐式匿名行为改成显式 Instance-only resolver 入口并补足错误场景测试。**已解决并加固。** |

Gate #2 对 R2-002 的判断依据是路由向 `testTts` 传了 Admin ID，但该 ID 在基线只用于 invocation audit log，未进入合成 resolver。PR-09 纠正了审查假设，并让 Instance 语义由专用入口保证，避免未来误传 actor。

## 4. 音频资产模型调查

| 证据面      | 当前事实                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Schema      | 活动实体为 `content_asset`；未发现活动 `article_audio` 表/实体。                                                                 |
| 唯一性      | `content_asset_part_kind_uidx` 以 `(part_id, kind)` 唯一；同一 Part 的同一 `audio_us` / `audio_uk` 只有一条资产行。              |
| 生成身份    | `buildContentAssetGenerationKey` 由 `partId`、`kind`、文本 `contentHash` 建立；租约 token 只协调同一资产的生成，不表达用户配置。 |
| 生成入口    | Catalog Admin Work/Part 音频生成 API 创建共享 Part 音频任务。Personal EPUB 上传当前可到 ready，不会因此创建用户专属 TTS。        |
| Reader 消费 | Reader audio API 查询已有 `content_asset` 音轨；没有从该请求排入 TTS 生成任务的路径。                                            |
| 资产作用域  | **Part-level shared asset**，不是 user-level 或 request-level 资产。                                                             |

## 5. 资产身份字段

| 字段                       | 是否属于当前资产身份                  | 当前用途                                               |
| -------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `workId`                   | 否（行上有外键，不是生成 key/唯一键） | 归属关系；Part 已关联 Work。                           |
| `partId`                   | 是                                    | 唯一音轨查找维度之一。                                 |
| `kind` / voice role        | 是（角色类别）                        | `audio_us` / `audio_uk` 选择。                         |
| 实际 voice 名称            | 否                                    | 仅在音频 metadata 保存生成声音；不参与资产唯一键。     |
| speed                      | 不存在                                | 当前配置/资产身份没有速度字段。                        |
| provider / model           | 否                                    | 不参与资产或 Redis cache 身份；当前 adapter 为 Azure。 |
| `userId` / owner           | 否                                    | `content_asset` 没有资产 owner 字段。                  |
| 配置 fingerprint / version | 否                                    | 未发现 TTS 配置指纹或版本参与生成身份。                |
| 文本 `contentHash`         | 是                                    | generation key 与对象路径组成部分。                    |

不同用户即使配置不同 Provider/Key/Voice，Reader 对同一 Part 与 role 仍命中同一资产行。不同 voice 会影响 Azure 合成和 Redis TTS cache key，但不会隔离 `content_asset` 的 `(partId, kind)` 唯一项。

## 6. 当前 TTS 运行时调用链

**已有音轨读取：**

```text
apps/web/features/reader/audio/reader-tts.tsx
→ apps/web/features/reader/reader-api.ts
→ GET /api/reader/parts/:partId/audio
→ readerRoutes
→ getPartAudioTrackForActor
→ requireReadablePart(actor, partId)
→ content_asset 查询（partId + audio kind，且要求 ready/hash 匹配）
→ ReaderAudioTrack / /api/assets/:id
```

**Catalog 预生成：**

```text
POST /api/admin/catalog/works/:workId/parts/:partId/audio/generate
→ requireAdmin / assertCatalogPart
→ enqueuePartAudio
→ claimPartAudioGeneration
→ BullMQ part-audio-generate
→ processPartAudioGenerate
→ runPartAudioGenerate
→ synthesizeTts（当前 job 未提供 userId，因此使用 anonymous → Instance）
→ resolveScopedTtsConfigRow / Azure adapter
→ concatMp3Buffers
→ partAudioChapterKey + putObject
→ content_asset 更新为 ready
```

Work 批量生成路由 `POST /api/admin/catalog/works/:workId/audio/generate` 对各 Part 使用同一 claim/queue/worker 链。存储由 `apps/backend/src/infra/storage` adapter 执行。

## 7. 用户上下文传播

- Reader route 从 session 建立 `WorkReadActor`；该 actor 用于 `requireReadablePart` 的访问授权。
- `getPartAudioTrackForActor` 的资产读取按 `partId + kind` 查共享行，不按用户筛选，也不调用 TTS resolver。
- Reader audio 请求只返回已生成音轨；不存在 Reader → queue → worker 的 TTS 请求链。
- Admin Catalog 生成由 `requireAdmin` 触发，enqueue payload 包含 `workId`、`partId`、role、force、generation key/token、previous keys，不含 `userId` 或 secret。
- Job schema 和 `PartAudioGenerateInput` 有可选 `userId` 字段，但当前 Admin enqueue 未提供它；字段存在不代表已形成用户隔离。
- 因此 User TTS 意图没有到达任何 resolver：Reader 在读取共享 ContentAsset 时就结束，没有用户 TTS 合成调用。不能将此概括成“只缺 worker userId”。

## 8. Cache 与共享资产语义

- 对象键为 `part-audio/{partId}/{kind}/{contentHash}/chapter.mp3`，没有用户、voice、provider 或配置版本。
- Redis TTS cache v2 key 由规范化文本、解析出的 voice、MIME type、region 和版本组成；不含用户 ID、Provider ID 或 credential/config fingerprint。
- 同文本、声音、区域的不同用户配置会共用同一 Redis cache 条目，即使分别配置了不同密钥。
- 不同 voice 虽可能得到不同 Redis cache key，最后仍竞争同一 Part/role 的 ContentAsset 唯一行和对象路径；重新生成可替换共享音轨。
- 当前没有产品决策说明用户启用自有 API 后是否继续命中已有 Instance 音轨、何时承担自有 provider 成本、以及 cache hit 是否算作“自有 TTS 已生效”。

## 9. Case A / Case B 决策

**结论：Case B — 当前共享预生成音轨不能安全承载 User TTS。**

依据同时满足用户要求的 Stop Condition：Part-level shared asset、资产身份不含用户或配置指纹、用户 TTS 设置与 Reader 音轨没有消费者、cache-hit/成本/已有 Instance 音轨优先级没有产品决定。只把 `userId` 写入队列不能隔离已有唯一行、对象键和 Redis cache，会产生配置互相污染、BYOK 成本生成公共资产、声音不一致及归属不清风险。

User TTS Runtime Closure 保持 Blocked；不对 job、asset schema、storage key、cache、Reader 或 User Settings 做 User TTS runtime 修改。

## 10. PR-09 实现

- 在统一 `provider-scope` 域新增 `resolveInstanceTtsConfigRow()`；它只读取 Instance 行并复用既有 `selectUsableTtsConfig` 可用性规则。
- 在统一 TTS synthesis service 新增 `synthesizeInstanceTts()` 显式入口；音频合成、Azure 调用、cache、错误处理均复用同一实现，不建立平行 resolver。
- Admin `testTts` 使用 Instance-only synthesis 入口。Admin ID 继续只作为审计主体写入 TTS invocation log，不再与合成 scope 混淆。
- 用户 TTS 合成入口 `synthesizeTts` 和 User Settings API 的既有 user-first 语义未改变；本阶段不声称它们已闭合 Reader runtime。

## 11. Admin Instance 隔离

| 场景                                        | 预期 / 结果                                            |
| ------------------------------------------- | ------------------------------------------------------ |
| Admin 没有个人 TTS，Instance 配置可用       | 使用 Instance 配置。                                   |
| Admin 有个人 TTS，Instance 配置可用         | 仍使用 Instance 配置，不读取 Admin 私人配置。          |
| Instance 配置缺失或不可用，Admin 有个人 TTS | 明确返回 TTS unavailable（HTTP 503），不回退个人配置。 |

API 路由仍为 `POST /api/admin/tts/test`，使用 `requireAdmin`，请求/响应契约未改变。此为管理诊断，不代表新增用户 Settings Test Connection。

## 12. User TTS 解析状态

`/api/settings/tts/config` 与 `/settings` 的 User TTS 配置管理仍存在。`synthesizeTts` 现有入口仍可按 authenticated actor 的 User → Instance 可用配置顺序解析；但 Reader 读取的是已生成共享音轨，没有把 User TTS 配置接入该消费链。因此：

```text
User Settings → User Resolver → Reader Runtime = Blocked
```

“Reader 播放成功”不能作为 BYOK 已生效的证据。保持 `Library ≠ Progress ≠ History` 及其实现不变。

## 13. Queue Context

本次没有修改 `PartAudioGenerateJobData`、enqueue 路由或 worker。现有 Catalog/Admin 生成 payload 不含 `userId`、API Key、ciphertext 或 Provider config。未来如启动获批的独立架构方案，必须重新决定谁触发生成及如何隔离资产；不得沿用本轮 shared payload 推断 User TTS 已支持。

## 14. Security

| 检查项                                      | 结果                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| secret 写入 queue payload                   | 0；本次未改 queue。                                                         |
| User A 凭据被 User B 的专属 resolver 读取   | 未发现跨用户配置读取；User TTS Reader consumer 尚未实现。                   |
| 凭据进入 ContentAsset metadata / object key | 未发现；metadata 记录 voice、时长、时间线等，不记录密钥。                   |
| secret 写入 API response                    | PR-08 mask/set-only 行为未变。                                              |
| secret 进入日志                             | 本次未记录明文凭据；resolver 解密仍仅发生于服务端。                         |
| Admin 私有配置影响 Instance probe           | PR-09 显式 Instance resolver 后为 0；Instance 不可用时不回退 Admin 私人行。 |
| upstream failure 静默回退 Instance          | 不发生；现有运行时失败仍按错误返回。本次 Admin probe 本身只解析 Instance。  |

## 15. 测试与验证

| 验证                                    | 结果                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tts-config.spec.ts` Admin TTS 功能测试 | 2/2 通过；包括 Admin 个人/Instance 配置并存仍用 Instance、没有个人配置使用 Instance、Instance 删除后 503 且不调用 Azure。 |
| `provider-scope/resolution.spec.ts`     | 2/2 通过。                                                                                                                |
| Backend TypeScript `tsc --noEmit`       | 通过。                                                                                                                    |
| 变更文件 ESLint                         | 通过；仅检查变更的后端源码与功能测试。                                                                                    |
| 变更文件 Prettier                       | 通过。                                                                                                                    |
| `git diff --check`                      | 通过。                                                                                                                    |
| Worker / Reader audio tests             | Not Run；本次未改 queue/worker/Reader/asset lookup。                                                                      |
| Backend Full Suite                      | Not Run；本阶段只运行目标 TTS/resolver 检查。                                                                             |
| Repository Suite / E2E                  | Not Run。                                                                                                                 |

工作树未包含依赖目录和 `.env.test`。测试只复用已安装的 PR-08 依赖，并临时链接已验证数据库名为 `gloaming_test` 的测试环境；测试 setup 自身再次强制该 DB 名。Vitest 环境校验需要 `RESEND_API_KEY`，本次命令提供 inert test placeholder；测试对邮件 adapter 使用 mock。pnpm workspace 状态检测尝试清理 linked modules 并在无 TTY 环境中中止，因此使用已安装的 Vitest/TypeScript/ESLint 二进制运行检查，没有安装或新增依赖。

## 16. Legacy / Direct-read Audit

| 类别                    | 当前发现                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Runtime resolver        | 普通 TTS `synthesizeTts` 使用 scoped resolver；Admin probe 使用显式 `resolveInstanceTtsConfigRow`。 |
| Admin config management | 管理配置 CRUD 仍使用 Instance config service；不把配置管理读取误记为 User runtime bypass。          |
| Reader runtime          | `getPartAudioTrackForActor` 读取现成 ContentAsset；没有 TTS 用户配置 consumer。                     |
| Worker                  | `runPartAudioGenerate` 经 `synthesizeTts`；当前 catalog job 不传 actor，按 anonymous → Instance。   |
| Secret/env              | 未发现凭据进入 job、资产 metadata 或 response；Azure secret 由 TTS config 解密用于服务端调用。      |
| `article_audio`         | 当前无活动表/实体；历史 admin invocation label 不作为旧音频 runtime domain。                        |
| 绕过审计                | 现有 `synthesizeTts` 业务入口未改；Admin test 与个人 resolver 的混用已由专用入口消除。              |

GitNexus workspace index 停在 PR-06 review `da5ede8b83673ec981459fea0091d8d9f5cdb279`，早于 Review Gate #2 和本阶段，故不将其图分析视作当前影响全景。按项目要求已人工复核调用方、接口和测试，并核对合成实现共用同一核心逻辑。

## 17. 范围审计

| 边界                                    | 本阶段状态                 |
| --------------------------------------- | -------------------------- |
| Library / Discover                      | 未改。                     |
| Settings UI                             | 未重设计、未改文案或导航。 |
| Reader UI / route                       | 未重设计、未修改。         |
| Provider schema / 数据库迁移            | 未改。                     |
| Architecture Subtraction / import cycle | 未开始。                   |
| Lazy TTS / streaming / per-user cache   | 未开始。                   |
| Billing / Quota                         | 未开始。                   |
| User-originated queue payload           | 未改。                     |

## 18. AI 参与决策

- 将 Admin 诊断的 actor ID（审计主体）与 TTS 配置 scope 分开；使用显式 Instance synthesis API 表达已确认的管理语义。
- 不因 Reader 请求存在认证用户就推断共享预生成音轨可被安全改成 User TTS。
- 将现有音轨优先级、cache hit、BYOK 成本以及未来 User TTS 隔离方式保留为待决定项，不由本阶段替用户选择。

## 19. 剩余产品 / 架构决定

`R2-001` 继续为 PR-10 readiness blocker。至少需明确：

1. User 自有 TTS 是否必须改变 Reader 实际播放内容与费用承担。
2. 已有 Instance 共享预生成音轨在 User TTS 启用后如何处理。
3. User TTS 缓存命中是否算作使用个人 Provider；不同用户如何隔离音轨及 cache。
4. 是否将此能力交由未来获批的 Lazy TTS epic 或另一个经批准的隔离模型处理。

这些决定未在 PR-09 自动关闭；当前没有 Lazy TTS Epic 批准记录。

## 20. Lazy TTS 边界

本阶段未创建或实现 Lazy TTS、Segment Audio、HTTP streaming、用户级音频存储/缓存，也未启动相关设计。若今后将 `R2-001` 重新分类为 Deferred，必须先取得针对 Lazy TTS Epic 的明确架构批准；PR-09 本身不作此决定。

## 21. 最终状态

- PR-09 Implementation：**Partial / Blocked**。
- 实现提交：`d49aa72024253de2fc21a4d48b26e7374c965f7d` (`fix(tts): isolate admin instance TTS checks`)。
- Admin Instance TTS isolation：**Resolved and hardened**。
- User TTS Runtime Closure：**Blocked by current shared audio asset model**。
- `R2-001`：Still Blocking；`R2-002`：Resolved。
- Human Review：Pending。
- `FRONTEND-VISUAL-001/002`：继续 Pending。
- Push：No；Merge：No；PR creation：No。
