# 用户优先架构评审索引

**评审关卡：** 01 — PR-01 至 PR-05
**审计基线：** `origin/dev` 位于 `4efa89a9944561ad4f57b37d57f115fd78f7f43f`
**评审头：** PR-05 检查点 `dd60b348a482268f126a2de936941a120225f005`
**评审分支：** `codex/user-first-review-gate-01`
**人工评审：** 各阶段均待完成

本目录是用户优先架构史诗的持久化证据链。它将已实现代码与设计意图、测试证据及未决的产品/数据决策分开记录。计划与 ADR 描述意图；Git 历史、源码、schema、路由与测试确立运行时事实。

## 架构基线

史诗前基线为 `origin/dev` 位于 `4efa89a9944561ad4f57b37d57f115fd78f7f43f`（`4efa89a9`）。下表各阶段均与其实际父提交对比。

## 阶段索引

| 阶段 | 提交 | 基线 | 主要领域 | 实现状态 | 人工评审状态 | 文档 |
| --- | --- | --- | --- | --- | --- | --- |
| PR-01 | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | `4efa89a9944561ad4f57b37d57f115fd78f7f43f` | Schema 基础 | 已实现 | 待完成 | [PR-01](pr-01-schema-foundation.md) |
| PR-02 | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | Work 读取访问策略 | 已实现 | 待完成 | [PR-02](pr-02-work-access-policy.md) |
| PR-03 | `dac344508f8f10faa38aed1721e8bab49a3572c3` | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | 发布 SSOT | 已实现 | 待完成 | [PR-03](pr-03-publication-ssot.md) |
| PR-04 | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | `dac344508f8f10faa38aed1721e8bab49a3572c3` | 摄取与 Catalog | 已实现 | 待完成 | [PR-04](pr-04-ingest-catalog.md) |
| PR-05 | `dd60b348a482268f126a2de936941a120225f005` | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | Library 领域 | 已实现 | 待完成 | [PR-05](pr-05-library-domain.md) |

「已实现」描述检查点范围内的代码。并不表示已获人工批准、已合并、已发布或已完成全量回归测试。

## 架构时间线

| 阶段 | 建立的运行时边界 |
| --- | --- |
| PR-01 | 数据库与共享契约可表示用户优先处理状态、发布时间、Library 成员行，以及可空的 Provider 归属。 |
| PR-02 | Work 读取采用归属感知访问：所有者、Admin，或已发布 Catalog Work 的读者。 |
| PR-03 | 发布是与处理状态无关的幂等 `published_at` 转换。 |
| PR-04 | 个人与 Catalog 的 EPUB 摄取共用摄取核心，但归属、可见性、认证与 Admin 策略彼此独立。 |
| PR-05 | Library 成员、阅读进度、阅读历史与继续阅读为彼此独立的运行时投影。 |

## 遗留演进

| 遗留概念 | 原含义 | 移除/变更于 | 替代方案 | 当前运行时状态 |
| --- | --- | --- | --- | --- |
| `reading_work.status` 混合流水线与发布 | 单一 status 同时表示处理、TTS 与已发布状态 | PR-01 | `processing_status` 加 `published_at` | 旧 DB 列/运行时字段已不存在。旧 `tts` 与 `published` 值迁移为 `ready`；负向契约测试可能提及旧值。 |
| TTS 作为 Work 处理状态 | `tts` 曾是 Work 的一种状态 | PR-01；PR-04 工作流筛选 | `workflowStep=tts`、工作流租约元数据及 `ContentAsset` 就绪 | `processing_status` 无 `tts`；TTS 仍为工作流步骤。Catalog 发布仍要求默认 US 音频就绪。 |
| 仅已发布内容的 Reader 访问 | 公共内容辅助逻辑仅放行已发布 Work | PR-02 | `WorkReadActor`、`workReadAccessSql` 与 `requireReadable*` | 所有者可读其私有 Work；Admin 可读全部；非所有者可读已发布 Catalog Work。 |
| `requirePublished*` 访问辅助 | 发布曾是通用读取门控 | PR-02 | `requireReadableWorkWithParts` / `requireReadablePart` | 活跃后端源码中不再存在 `requirePublished*` 辅助。Catalog 列表/发布仍检查 `published_at`。 |
| Admin `/works` 命名空间 | Admin Work 端点/页面未显式限定为 Catalog | PR-04 | `/admin/catalog/works`、`/api/admin/catalog/works` | 旧 Admin 路由无别名。内部 `domains/works` 与 `features/admin/works` 命名保留。 |
| 仅 Admin 的 EPUB 上传 | EPUB 摄取经 Admin 入口 | PR-04 | 经认证 `POST /api/works` 创建私有 Personal Work；Admin Catalog 上传仍独立 | 后端 Personal 上传存在；学习者上传 UI 缺失。 |
| `reading_state` 作为 Library 成员 | 打开/阅读可意味着「已保存」 | PR-05 运行时；PR-01 回填仍存在 | `user_library_item` 表示显式 Catalog 保存；Personal 以归属为准；`reading_state` 表示进度 | 未来阅读不会创建成员关系。迁移 0036 复制了每条历史 state 行；人工决策仍开放。 |
| Shelf API/领域 | `/api/shelf`、共享 Shelf 数据传输对象与 `features/shelf` 表示基于进度的成员 | PR-05 | `/api/library`、`@gloaming/shared/library`、`features/library` | 旧 Shelf 服务/模块已移除。`/my-shelf` 仍为 Web 路由与重定向目标。 |
| TTS 阻塞就绪 | TTS 曾嵌在 Work status 内 | PR-01 | 独立的 Work 处理状态与 TTS 工作流步骤 | 状态耦合已移除；既有发布门控仍要求默认 US 音频就绪。 |

## 决策关注清单

「需人工评审 = 是」的条目不是实现指令。当前数量：**10**（一项数据决策与九项产品决策）。

| ID | PR | 领域 | 决策 | 当前行为 | 产品/数据影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| PR05-HISTORY-001 | PR-01/05 | 历史数据 | 决定是否保留、删除或选择性恢复迁移 0036 产生的成员行 | 每条旧 `reading_state` 行均成为 `user_library_item`；无来源字段区分显式保存与阅读打开 | Library 可能夸大历史用户意图；可靠的选择性标记未确认 | 需人工产品/数据决策 |
| PR04-PRODUCT-001 | PR-04 | 重复上传 | 定义同一 EPUB 上传两次是创建两个 Work 还是一个 | 对象字节可按哈希复用，但每次摄取仍创建新 Work | 重复条目与独立进度 | 需产品决策 |
| PR03-PRODUCT-002 | PR-03/05 | 取消发布 | 决定 Catalog Work 未发布期间「已保存」成员的含义 | 成员行保留；Library 在无发布时隐藏；重新发布后再次可见 | 保存意图以不可见方式持久 | 需产品决策 |
| PR05-PRODUCT-003 | PR-05 | Library 身份 | 确认「Library」与保留的 `/my-shelf` 路由及未来路由迁移 | Library 语义位于 `/my-shelf` | 命名、导航、链接与长期 URL | 需产品决策 |
| PR05-PRODUCT-004 | PR-05 | Library 分组 | 决定拥有的 Personal Work 与保存的 Catalog Work 是否分组或统一并附来源标签 | 单一合并 API 列表；数据传输对象无显式成员/来源类型 | 用户可能不理解「拥有」与「保存的 Catalog」条目 | 需产品决策 |
| PR05-PRODUCT-005 | PR-04/05 | Personal 上传 | 决定上传入口及处理/失败如何呈现 | 认证上传 API 存在；Library 数据传输对象省略 `processingStatus` | Work 可被创建但无可见的上传/处理生命周期 | 需产品决策 |
| PR05-PRODUCT-006 | PR-05 | Personal 删除 | 定义用户如何删除拥有的 Work | 无学习者删除端点；Catalog 移除仅删除成员关系 | 「删除 Work」与「从 Library 移除」语义未决 | 需产品决策 |
| PR05-PRODUCT-009 | PR-05 | 历史可见性 | 决定是否告知用户部分 Library 条目为启发式迁移 | 迁移行与显式保存行成员形态相同 | 信任与清理预期 | 需产品决策 |
| PR05-PRODUCT-010 | PR-05 | 排序/容量 | 确认按最新创建/保存排序及固定 50 条结果上限 | 拥有行按 Work 创建排序；保存行按成员创建排序；结果有上限 | 大型 Library 可能遗漏条目；排序对用户可见 | 需产品决策 |
| PR05-PRODUCT-011 | PR-04/05 | Admin 体验 | 命名空间迁移后复审 Catalog Admin 文案与工作流呈现 | Admin 路径已 Catalog 限定；本审计未包含视觉改版 | 运营用语及与 Personal Work 的区分 | 需产品决策 |

## 最终验收清单

- [ ] PR-01 Schema 已由维护者评审
- [ ] PR-02 访问策略已由维护者评审
- [ ] PR-03 发布已由维护者评审
- [ ] PR-04 摄取与 Catalog 已由维护者评审
- [ ] PR-05 Library 已由维护者评审
- [ ] 用户优先前端已评审
- [ ] Provider 解析器已评审
- [ ] 设置已评审
- [ ] 历史迁移 0036 决策已解决
- [ ] 架构减法审计（Architecture Subtraction Audit）已完成
- [ ] 遗留清零（Legacy Remaining = 0）已对照运行时与契约验证
- [ ] 全量回归已完成
- [ ] 最终端到端（E2E）已完成
