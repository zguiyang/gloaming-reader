# 用户优先架构评审索引

**评审关卡：** 01 — PR-01 至 PR-06
**审计基线：** `origin/dev` 位于 `4efa89a9944561ad4f57b37d57f115fd78f7f43f`
**评审头：** PR-05 检查点 `dd60b348a482268f126a2de936941a120225f005`
**评审分支：** `codex/user-first-review-gate-01`
**人工评审：** 各阶段均待完成

本目录是用户优先架构史诗的持久化证据链。它将已实现代码与设计意图、测试证据及未决的产品/数据决策分开记录。计划与 ADR 描述意图；Git 历史、源码、schema、路由与测试确立运行时事实。

## 架构基线

史诗前基线为 `origin/dev` 位于 `4efa89a9944561ad4f57b37d57f115fd78f7f43f`（`4efa89a9`）。下表各阶段均与其实际父提交对比。

## 阶段索引

| 阶段           | 提交                                       | 基线                                       | 主要领域                                                  | 实现状态                                 | 人工评审状态 | 文档                                        |
| -------------- | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- | ------------ | ------------------------------------------- |
| PR-01          | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | `4efa89a9944561ad4f57b37d57f115fd78f7f43f` | Schema 基础                                               | 已实现                                   | 待完成       | [PR-01](pr-01-schema-foundation.md)         |
| PR-02          | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | Work 读取访问策略                                         | 已实现                                   | 待完成       | [PR-02](pr-02-work-access-policy.md)        |
| PR-03          | `dac344508f8f10faa38aed1721e8bab49a3572c3` | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | 发布 SSOT                                                 | 已实现                                   | 待完成       | [PR-03](pr-03-publication-ssot.md)          |
| PR-04          | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | `dac344508f8f10faa38aed1721e8bab49a3572c3` | 摄取与 Catalog                                            | 已实现                                   | 待完成       | [PR-04](pr-04-ingest-catalog.md)            |
| PR-05          | `dd60b348a482268f126a2de936941a120225f005` | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | Library 领域                                              | 已实现                                   | 待完成       | [PR-05](pr-05-library-domain.md)            |
| PR-06          | `b481a2fad4480f8d084d6e1a7fa7f6e96633db53` | PR-05 检查点                               | Provider 解析器 / 配置作用域                              | 已实现；目标测试通过，全量测试环境未通过 | 待完成       | [PR-06](pr-06-provider-resolver.md)         |
| PR-07          | `af20840164a1f6ed315f1ea017375d36e19ff2d3` | `bd0878ecdad664e406d7dd623915b9d7e44166cf` | User-first Library Frontend / Personal Upload / Read Flow | 已实现                                   | 待完成       | [PR-07](pr-07-library-frontend.md)          |
| PR-08          | `4f240d25fd0c7008c19e3e6f31cb88cba66ba803` | `7cef05b59c814a14e48821cec69ae060457dd9eb` | 用户设置 / 自带 API 前端                                  | 已实现                                   | 待完成       | [PR-08](pr-08-settings-byok.md)             |
| Review Gate #2 | `6f68abeb6e10f4553583e7729f2dbbaac984fb6f` | PR-06～PR-08 集成审查                      | 两条主链、域边界、复杂度与减法候选                        | 审查记录已完成；TTS 作用域问题阻塞 PR-09 | 待人工评审   | [Review Gate #2](review-gate-02-summary.md) |

「已实现」描述检查点范围内的代码。并不表示已获人工批准、已合并、已发布或已完成全量回归测试。

## 架构时间线

| 阶段           | 建立的运行时边界                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| PR-01          | 数据库与共享契约可表示用户优先处理状态、发布时间、Library 成员行，以及可空的 Provider 归属。                    |
| PR-02          | Work 读取采用归属感知访问：所有者、Admin，或已发布 Catalog Work 的读者。                                        |
| PR-03          | 发布是与处理状态无关的幂等 `published_at` 转换。                                                                |
| PR-04          | 个人与 Catalog 的 EPUB 摄取共用摄取核心，但归属、可见性、认证与 Admin 策略彼此独立。                            |
| PR-05          | Library 成员、阅读进度、阅读历史与继续阅读为彼此独立的运行时投影。                                              |
| PR-06          | LLM purpose 与 Provider 解析采用 User → Instance → Unavailable 的配置可用性顺序；upstream 失败不静默 fallback。 |
| PR-07          | `/library` 汇集个人上传与已保存 Catalog Work；继续阅读、进度与历史仍保持独立语义。                              |
| PR-08          | `/settings` 消费 PR-06 用户级 LLM / TTS API；Reader TTS runtime 消费仍待闭环。账户资料由 `/account` 管理。      |
| Review Gate #2 | PR-06～PR-08 主链与结构已审查；两个 TTS 作用域问题须先处理，PR-09 全范围减法暂不可开始。                        |

## 遗留演进

| 遗留概念                               | 原含义                                                                      | 移除/变更于                    | 替代方案                                                                                 | 当前运行时状态                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `reading_work.status` 混合流水线与发布 | 单一 status 同时表示处理、TTS 与已发布状态                                  | PR-01                          | `processing_status` 加 `published_at`                                                    | 旧 DB 列/运行时字段已不存在。旧 `tts` 与 `published` 值迁移为 `ready`；负向契约测试可能提及旧值。 |
| TTS 作为 Work 处理状态                 | `tts` 曾是 Work 的一种状态                                                  | PR-01；PR-04 工作流筛选        | `workflowStep=tts`、工作流租约元数据及 `ContentAsset` 就绪                               | `processing_status` 无 `tts`；TTS 仍为工作流步骤。Catalog 发布仍要求默认 US 音频就绪。            |
| 仅已发布内容的 Reader 访问             | 公共内容辅助逻辑仅放行已发布 Work                                           | PR-02                          | `WorkReadActor`、`workReadAccessSql` 与 `requireReadable*`                               | 所有者可读其私有 Work；Admin 可读全部；非所有者可读已发布 Catalog Work。                          |
| `requirePublished*` 访问辅助           | 发布曾是通用读取门控                                                        | PR-02                          | `requireReadableWorkWithParts` / `requireReadablePart`                                   | 活跃后端源码中不再存在 `requirePublished*` 辅助。Catalog 列表/发布仍检查 `published_at`。         |
| Admin `/works` 命名空间                | Admin Work 端点/页面未显式限定为 Catalog                                    | PR-04                          | `/admin/catalog/works`、`/api/admin/catalog/works`                                       | 旧 Admin 路由无别名。内部 `domains/works` 与 `features/admin/works` 命名保留。                    |
| 仅 Admin 的 EPUB 上传                  | EPUB 摄取经 Admin 入口                                                      | PR-04                          | 经认证 `POST /api/works` 创建私有 Personal Work；Admin Catalog 上传仍独立                | PR-04 检查点缺少学习者上传 UI；PR-07 在 `/library` 接入现有 Personal 上传 API。                   |
| `reading_state` 作为 Library 成员      | 打开/阅读可意味着「已保存」                                                 | PR-05 运行时；PR-01 回填仍存在 | `user_library_item` 表示显式 Catalog 保存；Personal 以归属为准；`reading_state` 表示进度 | 未来阅读不会创建成员关系。迁移 0036 复制了每条历史 state 行；人工决策仍开放。                     |
| Shelf API/领域                         | `/api/shelf`、共享 Shelf 数据传输对象与 `features/shelf` 表示基于进度的成员 | PR-05                          | `/api/library`、`@gloaming/shared/library`、`features/library`                           | PR-05 检查点仍有 `/my-shelf` 页面与重定向；PR-07 已删除旧页面并迁移到 `/library`，无兼容路由。    |
| TTS 阻塞就绪                           | TTS 曾嵌在 Work status 内                                                   | PR-01                          | 独立的 Work 处理状态与 TTS 工作流步骤                                                    | 状态耦合已移除；既有发布门控仍要求默认 US 音频就绪。                                              |

## 决策关注清单

「需人工评审 = 是」的条目不是实现指令。当前表中有 **14 项记录**：12 项仍待决定、2 项已由 PR-07 落实但仍待人工评审；其中两项 TTS 作用域问题阻塞 PR-09。

| ID               | PR       | 领域          | 决策                                                                      | 当前行为                                                                              | 产品/数据影响                                        | 状态                         |
| ---------------- | -------- | ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| PR05-HISTORY-001 | PR-01/05 | 历史数据      | 决定是否保留、删除或选择性恢复迁移 0036 产生的成员行                      | 每条旧 `reading_state` 行均成为 `user_library_item`；无来源字段区分显式保存与阅读打开 | Library 可能夸大历史用户意图；可靠的选择性标记未确认 | 需人工产品/数据决策          |
| PR04-PRODUCT-001 | PR-04    | 重复上传      | 定义同一 EPUB 上传两次是创建两个 Work 还是一个                            | 对象字节可按哈希复用，但每次摄取仍创建新 Work                                         | 重复条目与独立进度                                   | 需产品决策                   |
| PR03-PRODUCT-002 | PR-03/05 | 取消发布      | 决定 Catalog Work 未发布期间「已保存」成员的含义                          | 成员行保留；Library 在无发布时隐藏；重新发布后再次可见                                | 保存意图以不可见方式持久                             | 需产品决策                   |
| PR05-PRODUCT-003 | PR-05    | Library 身份  | 确认 Library 路由与导航名称                                               | PR-07 已迁移到 `/library`，无旧路由兼容                                               | 命名/导航已落实，人工接受仍 Pending                  | PR-07 已落实；人工评审待完成 |
| PR05-PRODUCT-004 | PR-05    | Library 分组  | 决定拥有的 Personal Work 与保存的 Catalog Work 是否分组或统一并附来源标签 | 单一合并 API 列表；数据传输对象无显式成员/来源类型                                    | 用户可能不理解「拥有」与「保存的 Catalog」条目       | 需产品决策                   |
| PR05-PRODUCT-005 | PR-04/05 | Personal 上传 | 确认上传入口及处理/失败呈现                                               | PR-07 在 `/library` 提供 EPUB 上传、处理中轮询及失败状态                              | 实现已存在；运行时视觉/人工接受仍 Pending            | PR-07 已落实；人工评审待完成 |
| PR05-PRODUCT-006 | PR-05    | Personal 删除 | 定义用户如何删除拥有的 Work                                               | 无学习者删除端点；Catalog 移除仅删除成员关系                                          | 「删除 Work」与「从 Library 移除」语义未决           | 需产品决策                   |
| PR05-PRODUCT-009 | PR-05    | 历史可见性    | 决定是否告知用户部分 Library 条目为启发式迁移                             | 迁移行与显式保存行成员形态相同                                                        | 信任与清理预期                                       | 需产品决策                   |
| PR05-PRODUCT-010 | PR-05    | 排序/容量     | 确认按最新创建/保存排序及固定容量                                         | 拥有行按 Work 创建排序；保存行按成员创建排序；当前上限为 48                           | 大型 Library 可能遗漏条目；排序对用户可见            | 需产品决策                   |
| PR05-PRODUCT-011 | PR-04/05 | Admin 体验    | 命名空间迁移后复审 Catalog Admin 文案与工作流呈现                         | Admin 路径已 Catalog 限定；本审计未包含视觉改版                                       | 运营用语及与 Personal Work 的区分                    | 需产品决策                   |

## Review Gate #2

[PR-06～PR-08 集成架构审查](review-gate-02-summary.md) 已记录当前双主链、域 SSOT、历史/删除依赖、测试事实和结构候选。结论：LLM、Library、Upload/Reader 核心边界稳定；`FRONTEND-VISUAL-001/002` 继续 Pending；User TTS 未接入 Reader runtime，且 Admin TTS probe 的 actor scope 与 Instance-only 记录不符。两项 TTS 问题解决或产品范围明确前，不开始 PR-09 全范围 Architecture Subtraction。审查不等于 Human Review Approved。较早的视觉基线仍作为视觉规范，但其中业务路由/API 表格是 PR-07 前的快照；当前事实以 Review Gate #2 为准，本轮未重写历史基线。

## Architecture Subtraction Candidates

| 候选                             | 证据                                                                    | 风险                                                | 结论                                                               |
| -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 后端 import-cycle SCC            | 当前源码静态扫描：1 个生产组件、30 个文件；PR-07 旧索引记录 32 条枚举环 | 高；覆盖 Ingest、Assets、Reading、Work Access、Jobs | 可供 PR-09 调查；先提出最小依赖割边计划与验证范围，不批量删 barrel |
| 合并 LLM / TTS provider 表       | 两者 cardinality、配置字段、消费流程不同                                | 可能混淆生命周期/权限                               | 无合表候选                                                         |
| 合并 Library 与 Progress/History | 独立 SSOT、读写职责不同                                                 | 破坏成员/进度/历史语义                              | 保护，不列候选                                                     |

## Integration Acceptance Watchlist

| ID                  | 验收项                               | 状态    | 触发条件                                                              |
| ------------------- | ------------------------------------ | ------- | --------------------------------------------------------------------- |
| FRONTEND-VISUAL-001 | PR-07 Library 运行时视觉验收         | Pending | User-first 分支进入统一 Integration Branch 且完整应用运行环境可用后。 |
| FRONTEND-VISUAL-002 | PR-08 Settings / BYOK 运行时视觉验收 | Pending | User-first 分支进入统一 Integration Branch 且完整应用运行环境可用后。 |

## 最终验收清单

- [ ] PR-01 Schema 已由维护者评审
- [ ] PR-02 访问策略已由维护者评审
- [ ] PR-03 发布已由维护者评审
- [ ] PR-04 摄取与 Catalog 已由维护者评审
- [ ] PR-05 Library 已由维护者评审
- [ ] 用户优先前端已评审
- [ ] 完整应用运行环境已启动并验证
- [ ] PR-07 Library 桌面视觉验收
- [ ] PR-07 Library 移动端视觉验收
- [ ] PR-07 明暗主题视觉验收
- [ ] PR-08 Settings implementation review
- [ ] PR-08 Settings 桌面视觉验收
- [ ] PR-08 Settings 移动端视觉验收
- [ ] PR-08 明暗主题视觉验收
- [ ] User TTS 的 Reader runtime 范围已确认且有实际消费者
- [ ] Admin TTS 连通性测试解析预期的 Instance 配置
- [ ] 已审查 PR-08 AI 单项用途重置与 Metadata purpose 运行时范围
- [ ] PR-09 开始前已解决 Review Gate #2 blockers
- [ ] 上传、处理中、失败状态视觉验收
- [ ] Catalog 移除交互视觉验收
- [ ] Personal Work → Reader 流程验收
- [ ] UI runtime Anti-AI 检查
- [ ] Provider 解析器已评审
- [ ] 设置已评审
- [ ] 历史迁移 0036 决策已解决
- [ ] 架构减法审计（Architecture Subtraction Audit）已完成
- [ ] 遗留清零（Legacy Remaining = 0）已对照运行时与契约验证
- [ ] Full Web regression 已完成
- [ ] Full Backend regression 已完成
- [ ] Repository regression 已完成
- [ ] Provider runtime 已验证
- [ ] Desktop / mobile 及明暗主题均已验收
- [ ] 全量回归已完成
- [ ] 最终端到端（E2E）已完成
