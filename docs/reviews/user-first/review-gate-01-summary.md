# 用户优先架构评审关卡 01 — 摘要

状态：PR-01 至 PR-05 已在各自检查点提交上实现
人工评审：各阶段均待完成
基线：origin/dev 位于 4efa89a9944561ad4f57b37d57f115fd78f7f43f
评审头：dd60b348a482268f126a2de936941a120225f005
分支：codex/user-first-review-gate-01

本摘要整合五份阶段审计。阶段文档包含逐文件路径、命名符号、路由/API 细节及历史验证证据。

## 当前架构

系统采用单一的 ReadingWork/ReadingPart 内容模型。Work 处理记录在 `processing_status`；Catalog 发布为 `published_at`。Work 可由所有者、Admin 读取，或在其为已发布 Catalog Work 时由非所有者读取。Personal EPUB 摄取通过共享摄取核心创建私有所有者 Work。Admin 上传与管理限定为 Catalog。Library 为拥有的 Personal Work 加显式保存的已发布 Catalog Work。ReadingState 为可选进度，阅读历史为行为记录，继续阅读为独立的进行中投影。

以上描述 PR-05 时的当前代码，不代表完整用户优先史诗已收尾。

## 五大核心领域

| 领域 | 单一事实来源（SSOT） | 主要实现 | 当前状态 |
| --- | --- | --- | --- |
| 归属 | `reading_work.owner_user_id`；显式保存用 `user_library_item` | PR-01 迁移/schema；PR-04 Personal 上传；PR-05 Library 服务 | Personal 归属与 Catalog 保存已实现。历史回填意图未决。 |
| 访问 | `canReadWorkRow`/`workReadAccessSql`，基于所有者、角色、可见性与 `published_at` | `apps/backend/src/domains/works/access`；Reader、资源、AI 上下文与历史等消费者 | 已实现所有者、Admin 与公共 Catalog 边界。 |
| 发布 | `reading_work.published_at`；`processing_status` 独立 | `apps/backend/src/domains/works/admin/admin-lifecycle.ts` | 幂等 Catalog 发布已实现。发布仍要求处理 `ready` 及默认 US 音频就绪。 |
| 摄取 | ReadingWork + `origin_file` ContentAsset；`origin_kind`/所有者/可见性 | `apps/backend/src/domains/ingest/epub/work-upload.ts`；Personal 与 Catalog 包装 | 共享解析/存储路径、策略分离已实现。Personal UI 缺失。 |
| 书架（Library） | 拥有 Work 与 `user_library_item` 的并集；`reading_state` 为可选进度 | `apps/backend/src/domains/library/service.ts`；`@gloaming/shared/library`；Web Library 功能模块 | GET/添加/移除与消费者迁移已实现。迁移 0036 行仍为人工决策项。 |

## 前后对比

| 关切点 | origin/dev 4efa89a9 | PR-05 检查点 |
| --- | --- | --- |
| Work 生命周期 | status 混合流水线、`tts` 与 `published` | `processing_status` 加 `published_at` |
| 访问 | 共享读取门控假设仅已发布 | 所有者/Admin/公共 Catalog 访问策略 |
| 发布 | 表示为 Work status 转换 | 独立、幂等的 `published_at` 转换 |
| EPUB 摄取 | 面向 Admin | 共享核心；Personal 私有所有者上传与 Admin Catalog 摄取 |
| Admin Work 命名空间 | `/admin/works` 与 `/api/admin/works` | `/admin/catalog/works` 与 `/api/admin/catalog/works`，旧别名已移除 |
| 书架（Library） | `reading_state` 隐含书架成员 | 拥有 Work 加显式 Catalog 保存 |
| 进度/历史 | `reading_state` 亦隐含成员 | 进度、历史与成员分离 |
| Provider 作用域 | 仅实例级运行时 | schema 有 `owner_user_id`；运行时仍面向实例 |
| 前端 | 既有 Shelf 消费者 | Library 功能模块与 API 迁移；无大范围应用外壳重写 |

## 已删除的主要遗留

在 PR-01..PR-05 内确认：
- `reading_work.status` 存储字段及处理枚举值 `published`/`tts`。
- `requirePublished*` 辅助作为通用读取访问门控。
- Admin `/admin/works` 与 `/api/admin/works` 路由；无兼容别名。
- 后端 Shelf 领域、Shared Shelf 包、Web Shelf feature/API 接缝与 `/api/shelf`。
- `add_to_shelf` 作为 Reader state 变更。

未删除：
- `/my-shelf` Web 路由与 Reader 返回路径。
- TTS 工作流步骤及其默认 US 发布就绪要求。
- 内部 `domains/works` 与 `features/admin/works` 命名。
- 迁移 0036 创建的历史 `user_library_item` 行。
- 遥测/Admin 标签中的 Article 类用词不能证明存在 Article 内容模型。Article 模型删除早于本审计范围。

## 决策关注清单

README 含 **10** 项开放条目：PR05-HISTORY-001 加九项产品决策。历史项是唯一可改变已迁移数据的决策。未做出数据侧选择。

## 架构减法候选

七组候选供后续人工评审；本审计未移除任何一项：
1. Work 读取/公共 Catalog 谓词的 SQL 与内存形式表示重叠规则。
2. 访问策略的执行者、谓词与编排文件可能在所有消费者稳定后需要内聚性评审。
3. Catalog 谓词针对不同问题（Catalog 身份与已发布公共访问）；验证各真实调用方，仅在区分仍成立时保留。
4. Personal 与 Admin 多部分表单处理器在共享摄取核心外重复传输大小/字段校验。
5. Library 与 Reader 各有本地 Work 摘要映射器。
6. Library 返回独立的 current 卡片与 items 列表；验证 current Work 是否可在两投影中重复出现及 UI 是否两者皆用。
7. 共享包/Web Library API、客户端与公共接缝为独立文件；仅在公共消费者边界需要时保留。

以上为候选，非缺陷。共享 EPUB 核心有真实 Personal 与 Catalog 消费者，该抽象由当前调用点支持。

## 前端就绪度

### 后端现已支持

- 在 PR-02 策略下，所有者可读私有 Personal Work，非所有者可读已发布 Catalog。
- 经认证 Personal EPUB 上传：`POST /api/works`。
- Library 读、显式 Catalog 保存与移除：`/api/library`。
- Reader 进度与阅读历史独立于 Library 成员。
- 发现页/图书详情成员调用经 Library API。

### 后端仍缺失

- Provider 解析器与用户作用域 Provider 运行时；`owner_user_id` 仅为 schema 铺垫。
- 设置 API/运行时与设置 UI。
- 学习者上传界面、处理/失败/重试 UI、个人 Work 删除语义。
- Library 摘要字段中的处理状态与显式来源/成员类型。
- 任何遗留清零（Legacy Remaining = 0）或完整史诗回归验收的声明。

### 前端工作前需 UI/产品讨论

- 迁移 0036 历史成员处理及对用户的告知。
- 产品记录冲突：`mvp-scope.md` 与原型流程/较旧 MVP 文档仍描述「加入书架」创建 ReadingState，而已接受的 ADR-001 称成员与进度分离。在将任一方视为当前 UI 行为前须调和记录。
- Library 名称/路由、Personal 与 Catalog 来源标签、上传位置、处理状态及删除/移除区分。
- 未发布期间保存的 Catalog 成员、重复上传语义、固定结果上限/排序及 Catalog Admin 文案。
- 本审计不提供新的视觉或交互答案。

## 验证证据

PR 阶段报告记录的历史定向结果：
- PR-01：共享包 14/14；数据库约束 4/4；Work EPUB 19/19；后端聚焦回归 97 项测试；Web 33/33；范围内类型检查/代码检查通过。
- PR-02：后端 47/47；后端类型检查/代码检查通过。
- PR-03：后端 35/35 与共享包 14/14；后端/Web 类型检查与范围内代码检查通过。
- PR-04：后端 25/25、共享包 15/15、Web 5/5；范围内类型检查/代码检查/格式化通过。
- PR-05：Library 3/3；回归 9/9；分类 4/4；共享包 154/154；Web 47/47；后端/Web/共享包类型检查与范围内代码检查/格式化通过。
- PR-05 未运行完整后端套件。各阶段未报告运行完整单体仓库套件。
- 以上结果为既往运行证据，非本仅文档关卡内重跑。

## 风险发现

数量：6。
1. 迁移 0036 全量回填可能夸大历史 Library 意图；未确认选择性来源追溯。
2. 活跃产品流程记录与关于 Shelf 成员与进度的修订已接受 ADR 冲突。
3. Provider owner 列存在但无用户作用域 Provider 运行时；勿将 schema 当作能力。
4. Library 数据传输对象省略 Personal `processingStatus`/来源类型，且无学习者上传/处理 UI。
5. 未发现可执行的遗留清零（Legacy Remaining = 0）门控；史诗收尾未验证。
6. 完整后端与完整单体仓库验证未运行/未报告；定向结果非全套件证据。

## 维护者交接

### 1. 最重要的 15 项变更是什么？

1. `reading_work.status` 已移除。
2. Work 处理使用 `processing_status`。
3. 发布使用 `published_at`。
4. 旧 `tts`/`published` 值迁移为 `ready`。
5. 新增 `user_library_item`，含 user/work 唯一性。
6. Provider/config 表增加 `owner_user_id` schema。
7. `WorkReadActor` 提供与传输无关的身份。
8. 所有者/Admin/已发布 Catalog 读取策略在各消费者间共享。
9. 资源与 AI 上下文遵循 Work 访问而非「凡已发布即可读」。
10. `publishWork` 变为 Catalog 限定且幂等。
11. Personal EPUB 上传经认证并创建私有所有者 Work。
12. Personal 与 Catalog ingest 共享存储/解析核心但保留独立策略。
13. Admin Work 页面/API/audio 迁至 Catalog 命名空间且无别名。
14. TTS 为工作流步骤而非 Work 处理状态；发布音频门控保留。
15. Library 成员、进度、历史与继续阅读为独立投影。

### 2. 实际删除了哪些旧架构？

Work status 字段、通用 `requirePublished` 辅助、旧 Admin 端点/页面路径、Shelf 后端/shared/web 领域/API 模块及 `add_to_shelf` action 已移除。未保留为运行时别名。Article 模型已在本范围之外。

### 3. 哪些概念更名但仍存在？

Admin Work 对外更名为 Admin Catalog，但内部 works/admin/works 模块名保留。Shelf 在服务/API/契约中变为 Library，但 `/my-shelf` 路由保留。TTS 离开 Work status 枚举但仍为工作流步骤与发布门控。`published` 变为 `published_at`，非移除。Provider 归属在 schema 可表达但非可用的用户-provider 能力。

### 4. 哪些新抽象值得评审？

访问的执行者/谓词/策略拆分、并行 SQL/行谓词、共享 EPUB 摄取核心加包装、Catalog 谓词形式、各功能模块的 Work 摘要映射器，以及 Library 的多文件 API/客户端/公共接缝。共享摄取核心被 Personal 与 Catalog 流程使用，对当前有直接价值。

### 5. AI 在哪些处为产品负责人做了选择？

将每条旧 `reading_state` 回填为 Library 保存；将旧 `published` 与 `tts` 映射为 `ready`；选择 settings 主键/索引实现；同哈希上传复用字节但创建不同 Work；未发布期间保留保存行；选择 Library 排序与 50 条上限；Library DTO 不返回 origin/处理状态；保留 `/my-shelf`。这些选择及当前影响已记录；未静默应用待决数据决策。

### 6. 下一阶段前必须讨论哪些决策？

解决迁移 0036；确认 Library 身份/来源标签与路由；规定上传/处理/失败与个人删除；决定未发布成员与重复上传行为；调和活跃产品流程文档与 ADR-001；在 Provider 工作前评审 Provider 归属/运行时预期。

### 7. 若用户优先开发在此停止，系统处于何状态？

PR-01 至 PR-05 代码存在于本地检查点。Schema、访问、发布、摄取与 Library 后端领域已实现，并有定向历史验证。PR-05 待人工评审。Provider 用户作用域运行时未实现，设置未实现，广泛用户优先前端工作未启动，历史 Library 成员未决，遗留清零（Legacy Remaining = 0）未证明。

### 8. 后端是否就绪以支撑用户优先前端垂直切片？

部分就绪。支持 Library/Reader 切片：归属感知阅读、Library GET/add/remove、进度/历史分离及后端 Personal 上传。未向 UI 提供完整 Personal 上传生命周期：Library DTO 省略处理/来源类型，无上传 UI 或删除流程，产品记录对旧 Shelf 行为冲突。窄 Library/Reader 垂直切片有后端基础；完整上传与 Library 体验仍需产品/API 决策。

### 9. 先做 PR-06 Provider 再做 Frontend 的影响？

PR-01 提供可空 `owner_user_id` 与部分唯一约束。既有 Admin Provider/LLM/TTS 服务仍查询并变更实例配置；无用户解析器、用户增删改查契约、作用域感知 UI 或用户回退行为。PR-06 可基于 schema 构建，但必须定义运行时归属并保护既有 Admin 实例行为。仅为依赖分析；不选择排序。

### 10. 评审关卡 02 应放在何处？

建议在 PR-07 设置实现完成后、广泛用户优先前端工作开始前。该关卡可一并评审 Provider 与设置作为单一作用域/归属边界，再让前端消费经人工评审的后端契约。
