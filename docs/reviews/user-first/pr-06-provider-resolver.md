# PR-06 — Provider 解析器与用户优先配置作用域

## 1. 元信息

- 阶段：PR-06 — Provider Resolver / User-first Config Scope
- 分支：`codex/user-first-pr06-provider-resolver`
- 基线：PR-05 检查点 `dd60b348a482268f126a2de936941a120225f005`
- 当前状态：实现已在本地提交；目标测试、类型检查、ESLint、Prettier 与差异检查已通过；全量后端测试因缺少环境变量未通过，人工评审待完成
- 范围：LLM/TTS 配置作用域、运行时解析、用户配置 API、调用方身份传递
- 提交：实现提交 `b481a2fad4480f8d084d6e1a7fa7f6e96633db53`；本审查记录另行提交；未推送、未合并

## 2. 本阶段目的

PR-01 已为 `llm_provider`、`llm_app_setting`、`tts_config` 建立可空用户归属及约束。此前运行时主要读取 Instance 配置，Admin 管理查询也未统一排除用户 Provider。PR-06 让现有归属字段进入解析和管理路径，并为 PR-07 提供最小后端配置接口。

## 3. 改动前状态

- `resolveModelRowId` 仅从 Instance 的 `llm_app_setting` 读取用途模型。
- `llm_model` 通过 `providerId` 关联 Provider，但解析时未检查 Provider 归属。
- Admin Provider/Model 管理查询可能读写任意归属的记录。
- TTS 合成从固定 ID 读取单条配置，没有用户优先与 Instance 回退。
- Dictionary AI 补全调用 `invokeAi` 时未传递登录用户 ID。
- 没有认证用户可用的 LLM/TTS 配置 API。

## 4. 改动后状态

- `owner_user_id IS NULL` 表示 Instance；非空值表示该用户。Model 作用域继承其 Provider。
- 已认证 LLM/TTS 请求优先解析可用的用户配置，再解析可用的 Instance 配置；匿名 LLM/TTS 只解析 Instance。
- 配置缺失、归属不符、禁用、运行时不支持或凭据无法解密时，解析阶段可回退 Instance；两级均不可用时沿用现有不可用错误。
- Provider 请求启动后发生超时、配额错误、5xx 或其他运行时失败时，不重新解析或切换 Provider。
- Admin LLM 配置管理限定 Instance；Admin TTS 配置管理与连通性测试限定 Instance。审计记录仍保留 Admin 操作者 ID。
- 用户配置 API 从认证 session 取得用户 ID，并只允许操作本人记录；密钥响应为掩码。

## 5. Git 改动摘要

本工作树相对 PR-05 基线含有后端运行时代码、配置 API、测试及文档变更。当前修改尚未暂存或提交；未创建迁移、未新增依赖、未修改前端文件。完整路径以提交前的 `git status --short --untracked-files=all` 为准。

## 6. 文件改动清单

| 路径                                                                                                                         | 变更                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/backend/src/domains/provider-scope/**`                                                                                 | 新增 LLM/TTS 作用域类型、所有权检查及配置选择                   |
| `apps/backend/src/domains/ai/runtime/purpose-model.ts`、`service.ts`                                                         | 将用户身份纳入用途模型解析；显式模型 ID 仍做归属检查            |
| `apps/backend/src/domains/llm/config/providers/service.ts`、`models/service.ts`、`settings/service.ts`                       | Admin 读写限定 Instance                                         |
| `apps/backend/src/domains/llm/config/user/**`                                                                                | 新增用户 Provider、Model、用途设置接口与服务                    |
| `apps/backend/src/domains/llm/config/routes/index.ts`                                                                        | 挂载认证用户配置路由                                            |
| `apps/backend/src/domains/tts/config/store.ts`、`service.ts`、`user-service.ts`                                              | 区分 Instance 配置与用户配置；复用安全响应映射                  |
| `apps/backend/src/domains/tts/config/test-connection.ts`、`synthesis/service.ts`、`routes/index.ts`、`routes/user-config.ts` | TTS 解析按作用域运行；Admin 测试固定 Instance；挂载用户配置 API |
| `apps/backend/src/domains/dictionary/lookup/enrichment.ts`、`service.ts`                                                     | 将登录用户身份传到 AI 补全；匿名身份保持为空                    |
| `apps/backend/tests/functional/domains/provider-scope/**`                                                                    | 新增解析、API 作用域和安全测试                                  |
| `apps/backend/tests/functional/domains/tts/tts-config.spec.ts`                                                               | 增加 Admin TTS 测试使用 Instance 配置的回归覆盖                 |
| `docs/reviews/user-first/pr-06-provider-resolver.md`                                                                         | 本阶段审查记录                                                  |
| `docs/reviews/user-first/README.md`                                                                                          | 加入 PR-06 阶段索引与运行时边界                                 |
| `docs/plans/user-first-architecture-implementation.md`、`docs/product/engineering-vocabulary.md`                             | 同步 PR-06 状态与术语                                           |

## 7. 符号与方法清单

- `runtimeActorFromUserId`：将可选用户 ID 归一为已认证或匿名 Actor。
- `requireInstanceProvider`、`requireUserOwnedProvider`、`assertModelAccessibleForActor`：限定 Provider/Model 的可见归属。
- `resolveScopedAppSettingValue`：按用途获取用户候选与 Instance 候选，并跳过不可用 LLM 配置。
- `resolveScopedTtsConfigRow`、`selectUsableTtsConfig`：选择可用用户 TTS 配置或 Instance 配置。
- `resolveModelRowId`：AI 用途模型解析入口；显式模型 ID 仍校验 Actor 可访问性。
- `listUserProviders`、`createUserProvider`、`updateUserProvider`、`deleteUserProvider`、`listUserModels`、`createUserModel`、`updateUserModel`、`deleteUserModel`、`listUserSettings`、`putUserSetting`：用户 LLM 配置服务方法。
- `getUserConfig`、`putUserConfig`：用户 TTS 配置服务方法。

## 8. 删除代码清单

没有删除文件或公共业务能力。原 `tts/config/store.ts` 中不区分归属的固定 ID 读取已替换为明确的 Instance 行读取；合成运行时不再依赖该单例读取器。

## 9. 数据库与数据模型

没有 schema、迁移或历史数据变更。继续使用：

- `llm_provider.owner_user_id` 区分 Instance 与用户 Provider。
- `llm_model.provider_id` 继承 Provider 的作用域。
- `llm_app_setting.owner_user_id + key` 区分用户用途选择与 Instance 用途选择。
- `tts_config.owner_user_id` 区分用户配置与唯一 Instance 配置。

新增测试只写入自身创建的测试用户、Provider、Model、Setting、TTS 行，并按 ID 清理。测试必须由仓库 setup 锁定在 `gloaming_test` 和 Redis DB 1。

## 10. API 变更清单

新增认证用户 API（用户 ID 来自 session，不接受请求方指定归属）：

- `GET/POST /api/settings/llm/providers`
- `PATCH/DELETE /api/settings/llm/providers/:id`
- `GET/POST /api/settings/llm/models`
- `PATCH/DELETE /api/settings/llm/models/:id`
- `GET /api/settings/llm/settings`
- `PUT /api/settings/llm/settings/:key`
- `GET/PUT /api/settings/tts/config`

用户 Provider 与 TTS 响应沿用现有 DTO，只返回密钥是否已设置及掩码，不返回明文密钥。跨用户 ID 操作返回未找到。未新增用户侧 Provider 连通性测试、余额查询、自动模型发现或 UI。

## 11. 运行时调用流程

- LLM：业务调用 `invokeAi` / `streamAi` → 按用途读取 User/Instance 配置 → 校验 Model/Provider 归属、启用状态、运行时支持和密钥可解密 → 选择一个 Model → 调用上游一次。解析完成后不再因上游失败切换配置。
- 显式 Model ID：用于 Admin 测试等既有场景；先做归属校验，再解析该 Model，不做隐式替代。
- TTS：`synthesizeTts` → 选择可用用户配置或 Instance 配置 → 解密最终密钥 → 缓存/调用 Azure。Admin 连通性测试不把审计者 ID 传入解析器，因此固定使用 Instance。
- Dictionary：路由提供 `WorkReadActor`；登录用户 ID 传至 LLM 运行时，匿名请求仍只解析 Instance。
- Catalog/Metadata 系统工作没有用户 Actor，沿用 Instance 配置。TTS 作业既有可选 `userId` 上下文仍可承载用户来源任务。

## 12. 行为变化

- 用户的用途选择和 Provider 不再被其他用户读取或使用。
- 用户配置不可用时在调用上游前退回 Instance；没有可用配置时返回现有 AI/TTS 不可用错误。
- 上游调用失败保留为失败，不产生未经明确选择的 Instance Provider 成本。
- Admin 视图与操作不会因用户 Provider 的存在而混入或修改用户记录。
- Guest Dictionary 保持原有认证边界，不因 Provider 支持而扩展匿名权限。

## 13. AI 实现选择

以下是本次实现选择，需维护者审阅，不宣称为新的产品政策：

- 把缺少用途设置、Model/Provider 缺失或不可访问、禁用、未实现 API family、无效 wire variant、无法解密凭据定义为配置不可用，并允许解析阶段尝试 Instance。
- 两级配置均不可用时使用当前 AI/TTS 错误体系，不新增通用错误框架。
- 用户侧配置路由置于 `/api/settings/*`，以供 PR-07 接入；不增加前端实现。
- Admin TTS 连通性测试将审计操作者和解析作用域分离：保留操作者 ID 记日志，解析固定 Instance。
- 用户设置 API 不提供自动探测或计费功能；用户选择 Model 必须引用可访问的记录。

## 14. 测试与验证

- `pnpm --filter @gloaming/backend exec tsc --noEmit`：通过。
- `apps/backend/tests/functional/domains/provider-scope/resolution.spec.ts`：2/2 通过。
- `apps/backend/tests/functional/domains/provider-scope/user-first-provider-resolver.spec.ts`：5/5 通过。
- `apps/backend/tests/functional/domains/llm/llm-config.spec.ts`：2/2 通过。
- `apps/backend/tests/functional/domains/tts/tts-config.spec.ts`：2/2 通过。
- PR-06 目标功能测试合计：11/11 通过；功能测试连接由仓库 setup 限定在 `gloaming_test`，Redis 使用 DB 1；认证邮件发送在这些目标测试中 mock。
- TypeScript 检查、Prettier 格式检查与 `git diff --check`：通过。
- ESLint：本次变更涉及的后端源码与功能测试文件通过。
- 后端全量测试曾被意外启动一次，原因是通过 package script 传递文件路径时多余的 `--` 被解释为无筛选运行。结果为 88 个文件中 42 个通过、46 个失败；304 个测试中 297 个通过、6 个失败、1 个跳过。失败由测试环境缺少 `RESEND_API_KEY` 引起，故全量套件不视为通过。
- 全仓测试与 E2E：未运行。

## 15. 遗留路径审计

- 用户业务绕过作用域解析：目标为 0；以 `invokeAi`、`streamAi`、`synthesizeTts` 调用点审查确认。
- 业务运行时直接读取全局 LLM/TTS Provider：目标为 0；Admin 配置读取单独归类。
- 运行时直接从环境变量选择 Provider/模型：未发现；LLM 环境变量读取用于配置加密密钥或标准网络代理，不作为 Provider 选择。
- 兼容性别名/双表：未增加。
- `tts/config/store.ts::loadConfigRow` 保留为显式 Instance 配置读取，仅供 Admin TTS 配置服务使用；运行时走 `resolveScopedTtsConfigRow`。
- GitNexus 索引已刷新；变更分析报告 35 个文件、293 个符号、66 条受影响流程，风险等级为 Critical，流程结果有截断。`resolveModelRowId` / `resolveScopedAppSettingValue` 的影响等级为 Critical，`synthesizeTts` / `resolveScopedTtsConfigRow` 为 High，因此图分析不是 all-clear。源码调用点复核覆盖 Translate、Assist、Dictionary、Metadata、Admin Provider 测试、Admin TTS 测试与音频生成任务；各路径身份传递按本节前述规则处理。

## 16. 范围审计

- PR-07 Settings UI：未开始。
- 前端导航或页面：未修改。
- Library UI：未修改。
- Provider Schema 合并或数据库迁移：未开始。
- Lazy TTS：未开始。
- 账单、配额、云/自托管分支：未开始。
- 依赖新增：未发生。
- PR-05 migration 0036 历史数据决策：保持待定，未触碰。
- push / merge：未进行。

## 17. 前端影响

PR-07 可基于本阶段后端接口列出并维护本人 Provider/Model、为用途选择本人模型、维护 TTS 配置。Provider/TTS 响应不含明文 secret。运行时用户配置不可用时继承 Instance 配置。以上仅记录现有后端契约，不设计 Settings 页面。

## 18. 风险与未决问题

- BYOK 调用发生上游错误时不会使用 Instance 代付；如未来要改变，需单独产品决策并明确告知用户。
- 当前接口没有 Provider 测试连接、远端模型发现、余额或用量 API；这些不属于 PR-06 目标。
- 用户用途绑定无效时的回退语义需维护者确认与 PR-07 文案一致。
- 当前自动审批审核曾超时，后改为本地执行；实现仍须经独立检查和 `gloaming_test` 验证。
- 全量后端回归和最终 E2E 尚未完成。

## 19. 架构减法候选

只记录，当前不处理：

- `resolveScopedAppSettingValue` 的可用性检查与 `infra/llm/resolve.ts` 都会读取 Model/Provider 信息，评估能否在保持层次边界的同时减少重复查询/解密。
- `tts/config/store.ts::loadConfigRow` 目前是 Admin 配置读写路径的 Instance 包装，可在未来确认是否有独立价值。
- 用户与 Admin Provider DTO 转换存在相似字段映射；确认安全差异后再评估是否复用，避免为复用暴露密钥。

## 20. 最终状态

PR-06 实现已在隔离工作树本地提交 `b481a2fad4480f8d084d6e1a7fa7f6e96633db53`；类型检查、ESLint、Prettier、差异检查与 4 个目标功能测试（11/11）通过。全量后端测试因测试环境缺少 `RESEND_API_KEY` 未通过；阶段仍待人工审查及决定如何处理全量测试环境。GitNexus 索引已在提交后刷新；变更流程报告为 Critical 且有截断，不能视为 all-clear。源码调用点已复核，LLM 覆盖 Translate/Assist/Dictionary/Metadata/Admin，TTS 覆盖 Admin 诊断和音频生成任务。当前未推送、未合并。
