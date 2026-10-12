# Gloaming Agent Rules — Phase 2B Independent Review

- 审查日期：2026-10-12（Asia/Shanghai）
- 审查分支：`dev-02`
- 基准 HEAD：`92bb1f58f463ed5b90619d2b3dbfa57f89e6ab8d`
- 对象：当前工作区规则体系、相对 HEAD 的迁移差异及其有效依据。
- 本轮权限：只新增本报告；不修复规则、ADR、代码、测试或配置。

## 1. Executive Summary

**Review Gate：PASS WITH FOLLOW-UPS。**

`AGENTS.md → rules/ → 按需读取 Skills、有效 ADR 和当前实现` 的结构成立。四份新规则具有明确适用范围，关键认证、授权、测试隔离、数据完整性、公共契约和模块边界没有确认的迁移遗漏。规则不要求普通改动执行完整架构流程、全量测试、浏览器 E2E 或图分析；正常开发数据库操作与自动化测试已分开。

问题数量：**P0 = 0，P1 = 0，P2 = 2，P3 = 0**。两项 P2 均为被规则发现链引用的既有决策/产品文档漂移，已在 HEAD 中存在，不是此次迁移新增的规则缺陷。冲突报告和保留有效边界的要求仍在，因此不构成安全保护消失或迁移不可用。

建议结束四份详细规则的结构性重构；后续只做两处依据文档的定点对齐。当前 Diff 还包含 `.cursor/mcp.json` 删除，其阶段归属和授权未能独立确认，不能把整个工作区描述成“没有修改 MCP”。本报告不将该既有删除擅自归因于规则迁移，也不恢复它。

## 2. Reviewed Scope

### 2.1 实际读取与检查

| 范围           | 已审查内容                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局入口       | 根 `AGENTS.md` 全文及相对 HEAD 的完整 Diff                                                                                                                                                                     |
| 详细规则       | `rules/backend.md`、`frontend.md`、`packages.md`、`architecture.md` 全文                                                                                                                                       |
| 旧规则         | 通过 `git show HEAD:<path>` 读取四份被删除的 `.cursor/rules/*.mdc`；比较约束、工作流和实现硬编码                                                                                                               |
| 设计规则       | `DESIGN.md` 的规则引用、设计令牌入口、语言、键盘/移动端/可访问名称、交互与产品行为边界；检查全部本轮 Diff                                                                                                      |
| 领域与决策     | ADR-001～009 的相关有效决策、修订、公共模块和所有权约束；`docs/product/README.md`、`engineering-vocabulary.md`、`content-strategy.md` 的相关内容                                                               |
| 后端样本       | `src/app.ts`、`src/routes/index.ts`、`infra/auth` 集成入口、`infra/http/response.ts`、`infra/http/middleware/auth.ts`、`infra/config/env.ts`/`env-common.ts`、Discovery Admin 路由、Work 访问 policy/predicate |
| 前端样本       | Admin layout/shell、web-origin logout、会话模块、Auth/Navigation 公共入口、Library 公共数据入口、`globals.css`、Admin 路由及已删除路由的测试                                                                   |
| 契约与配置     | Shared/DB 的 `package.json`、Shared public-exports 测试、Work schema、DB schema/Drizzle 配置、根脚本、ESLint 跨应用/包依赖限制、Vitest 配置、Git hooks、`.gitignore`                                           |
| 测试证据       | 阅读管理员授权、Work 访问、Library membership/progress、环境验证和 Shared 公共出口的相关测试代码；未运行这些业务测试                                                                                           |
| Skills         | 项目 `codebase-guardrails`、`repository-structure`、`using-git-worktrees`、`test-database-workflow`，环境中的 `pi-delegate`；按范围审查其与项目边界的关系，未执行工作树/数据库/委派流程                        |
| Git 与阶段背景 | 已暂存、未暂存、未跟踪状态；`agent-rules-audit.md`、PC-07 报告及相关 Diff；`.cursor/mcp.json` 删除内容                                                                                                         |
| 官方机制       | Codex、OpenCode、Zed 官方说明中的项目规则发现机制；没有安装或启动这些 Agent 做加载测试                                                                                                                         |

本报告使用的路径均相对于仓库根目录，外部 Skill 和官方文档除外。没有全面审计业务代码；源代码只用于验证具体规则约束。

### 2.2 未验证内容

- 未执行业务测试、数据库连接/迁移、浏览器验收、生产服务操作、真实 AI 调用或 Pi Worker。
- 未验证所有 API 的权限实现、全部客户端安全行为或完整数据一致性；本结论针对规则覆盖及所列样本。
- 未验证 Codex/OpenCode/Zed 在各版本、个人配置和会话中的实际自动加载，也未把 Markdown 链接视为框架自动导入。
- 没有独立保存的 Phase 1 中间快照，不能从一个累计工作区 Diff 精确还原每次编辑的先后与授权。先前报告仅作阶段背景，不作通过凭据。

## 3. Architecture Assessment

职责划分总体合理：

| 所有者                  | 当前责任与判断                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `AGENTS.md`             | 产品核心禁区、安全/数据授权、委派隔离、规则发现和报告；没有固定 Pi session、模型或工具参数 |
| `rules/backend.md`      | 传输与领域职责、认证/权限、输入/错误契约、配置与持久化不变量                               |
| `rules/frontend.md`     | 页面组合与能力所有权、状态来源、客户端 UX 与后端权限、真实交互和设计系统入口               |
| `rules/packages.md`     | 公共契约单一所有者、Shared/DB 职责、消费者兼容、公共模块变更决策                           |
| `rules/architecture.md` | 所有权、依赖方向、公私边界、变更与迁移完成条件；仅针对相关边界变化                         |
| Skills/MCP              | Skills 负责方法；MCP 负责执行能力。规则未复制 Worker 参数、进程/session 管理或工具内部实现 |
| ADR/产品文档            | 已确认领域与具体模块决策；历史背景需与当前有效政策区分，见 P2 发现                         |
| 源码/配置/测试          | 当前路径、依赖版本、导出表、环境加载、脚本和机器约束                                       |

单一所有者、公私边界在架构、包和应用规则中存在必要的局部重申：架构规则提供判断标准，包规则承接 ADR-003，应用规则解释层级和安全应用场景。未发现相互竞争的导出白名单、模型配置或 dispatch 真源。

Worktree 的位置、忽略保护、委派写入隔离与禁止绕过拒绝属于项目安全边界。`AGENTS.md:54–77` 没有规定命令或工具参数，其兼容方法选择受到 Skill 契约限制，不是复制 MCP 实现。工具不支持项目默认位置时必须先检查正式支持的替代方法；不能仅因想完成任务而绕过拒绝。

安装的 Worktree Skill 含自动修改忽略配置并提交、以及 sandbox 失败后回到当前目录的通用流程。项目 `AGENTS.md:64–73` 明确覆盖这两种行为：未授权不改忽略规则，委派写任务隔离失败必须停止。Pi Skill 的 `direct` 也不能成为共享主工作区写入许可；可由主管分配已有隔离工作区后使用。没有创建工作树来验证这些工具能力，也不保证每种宿主都能无需额外授权满足默认位置。

## 4. Rule Quality Assessment

### 4.1 精简与硬编码

独立计数确认：旧文件为 Backend 44、Frontend 239、Packages 118、Repository Structure 186 行，共 **587 行**；新文件为 Backend 46、Frontend 52、Packages 46、Architecture 63 行，共 **207 行**，减少约 64.7%。旧总数包括四份 YAML 元数据；若严格只算去除 front matter 后的正文，为 563 行，不能混淆统计口径。根 AGENTS 为 120 行，以上 207 行不包含它。

四份规则没有固定源码内部文件、函数名、版本常量、环境地址或专属工具命令。`@gloaming/shared`、`@gloaming/db`、ADR-003、DESIGN 和退役业务名称属于确认的责任/政策标识，应保留。公共模块映射由 ADR/exports 负责，没有在规则中复制 19 项列表。

旧规则中的 Hono/Better Auth 集成具体入口、响应 helper 路径、TanStack/Zustand、Tailwind/shadcn 版本、Zod 版本、TS 选项和 CLI 安装方式，已改为发现当前拥有者与配置。抽样确认相应实现/配置仍能找到；不能把这类动态事实的删文等同于安全约束删除。

### 4.2 抽象程度

规则并非仅写“遵循现有模式”：

- 后端先发现 middleware/schema/response owner，所有受保护 API 做后端角色、所有权和资源校验，并验证允许/拒绝情况（Backend 19–32 行）。
- 前端状态规则给出“客户端状态不得成为第二 API 真源”和 mutation/cache/pending/error 保持条件（Frontend 18–24 行）。
- 公共入口要求 owner、明确路径、记录意图及真实消费者或具体稳定契约；文件名和 export 本身不能授予权限（Architecture 27–42 行）。
- 架构不确定时保留有效边界、报告开放选择，Draft 不授权改变 Accepted 决策；迁移未覆盖消费者不得宣称完成（Architecture 46–60 行）。

持久化规则没有枚举每个领域的全部不变量，但要求读取对应 ADR、维护作用域/并发语义并测试受影响不变量（Backend 41–44 行），符合按任务发现原则。主要不足在所引用依据的既有漂移，而非需要恢复长篇实现清单。

### 4.3 开发负担

未发现每次提交图分析、所有任务创建工作树、每改文件跑全量测试、所有数据库写入禁止、正常删文件重复审批、每次 UI 改动完整 E2E 或普通局部改动写 ADR 的规定。

`AGENTS.md:21–48` 区分已授权可逆工作、高风险操作、测试/开发/生产；85–89 行要求按影响验证。架构决策门只针对所有权、依赖、公私边界和核心契约。Git hooks 中的完整检查是现有 pre-push 行为，不是每次小改动的额外规则。

环境级委派要求针对匹配 Skill 的有边界执行任务，主管保留决策与验收；不能推导成每个任务或每一步都必须启动子 Agent。本轮明确不做真实 AI 调用，因此由审查 Agent 直接完成。

## 5. Critical Boundary Coverage

| 边界               | 新规则承接与实际依据                                                                                                                                  | 结论                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 登录/原生协议      | Backend 19–20、31–32；`apps/backend/src/app.ts` 把 `/api/auth/*` 交给 `auth.handler`                                                                  | 保留，未要求包装原生响应                                              |
| 认证与 Admin 授权  | Backend 21–24；`infra/http/middleware/auth.ts` 验证会话、共享 role，匿名 401、非 Admin 403；Discovery Admin 路由逐项有 guard，授权测试覆盖拒绝场景    | 明确保留；只阅读测试，未声称运行通过                                  |
| 所有权/资源访问    | Backend 21–24、41–44；Work policy/predicate 与访问测试区分 Personal owner、公开 Catalog 和具本人 membership 的 Source Work，Admin role 无默认内容旁路 | 规则允许发现具体策略，未将所有读接口误判为必须登录                    |
| 输入验证           | Backend 25–27；Admin validator/schema 边界；共享验证政策不得另写一份                                                                                  | 保留 structured/multipart/stream 区分                                 |
| 错误契约           | Backend 28–32；`infra/http/response.ts` 返回本地化 `error`、`code`、验证 `details` 和相应状态                                                         | 新规则比旧 `{ error, details? }` 描述更准确；流和原生 auth 按各自契约 |
| 敏感配置           | 根 25–26；Backend 36–40；环境集中 parse/fail-fast，并对秘密项输出脱敏                                                                                 | 保留秘密不得进客户端/提交的禁区                                       |
| 数据一致性         | Backend 41–44；ADR-001 Library 与 progress 分离，ADR-002 revision/唯一性/lease 归属；Library 测试比较移除前后的 progress                              | 保留；不从临时数据库状态创造新政策                                    |
| 测试隔离/迁移      | 根 27–42；Test DB Skill；`env-common.ts` 要求 Vitest 使用明确 `gloaming_test`，无 fallback；Drizzle 从拥有者配置迁移                                  | 无机制冲突；规则不替代实际目标核验                                    |
| Web/Backend 分离   | 根 12–14；ESLint `boundaries/dependencies` 禁止两个应用互相依赖；包禁止依赖应用实现                                                                   | 旧跨应用限制有规则与机器约束承接                                      |
| 客户端权限/退出    | Frontend 28–34；AdminShell session/role 检查；logout 清除 web-origin cookie 并向 backend sign-out 发请求                                              | 保留 UX gate 与真实授权区分；未审计失败重试等整个 logout 行为         |
| 状态与契约         | Frontend 18–24；Library 公共入口使用 Shared schema；Shared/DB 配置与消费者                                                                            | 不引入竞争的 state/DTO 来源                                           |
| 设计/可访问/原型   | Frontend 38–52；DESIGN 620、630、663 行及令牌入口；`globals.css` 使用统一令牌                                                                         | 保留键盘/移动端/可访问名称、设计与产品行为边界、source/UI stub 标签   |
| Shared 公共面      | Packages 9–37；ADR-003、exports 与 public-exports 测试一致为 19 个 subpath，无 root facade                                                            | 禁止 root 回归、深导入和消费者路径推断所有权                          |
| 私有边界/依赖      | Architecture 9–42、Frontend 10–17；ADR-004～009 的具体公共入口与组合例外                                                                              | 保留默认私有、明确导出、记录迁移例外与方向                            |
| 委派/Worktree/拒绝 | 根 54–79；忽略配置明确包含 `.worktrees/`                                                                                                              | 主管分配/验收/清理，Worker 不获额外权限，不绕过安全拒绝               |
| 产品领域限制       | 根 9–17；ADR-001 与词汇表保留 Article 退役、Work/Part、Library/State、Admin 无 Work CMS 等限制                                                        | 不需在根文件再次复制所有实体/流程；两项依据文档冲突见 Findings        |

### 5.1 只读文本场景检查

| 场景                                            | 根据当前文本得到的结果                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| 普通按钮样式修正                                | 读取 Frontend + DESIGN，做影响匹配检查；无通用架构/全量 E2E 门 |
| 新增管理员 API，只隐藏导航                      | 不通过；必须 backend Admin authorization，验证拒绝与允许案例   |
| 新建并行登录流程                                | 不通过；复用现有 auth integration，保留原生协议                |
| 改错误 JSON，丢掉 code/details                  | 不通过；先核对 response/schema/消费者，保留 owning contract    |
| 在 web 本地复制 auth bounds/DTO                 | 不通过；从共享 owner 公共入口 import/derive                    |
| 为便利恢复 Shared root facade                   | 不通过；需要独立 Accepted 决策与兼容策略                       |
| 将 Reader helper 提升为公共入口，只说未来会复用 | 不通过；缺真实消费者或明确稳定契约/框架理由                    |
| 模块迁移只移动文件、不迁消费者                  | 不能宣称完成；检查 exports/imports/tests/config 与退出条件     |
| 自动化测试缺少可靠 test target                  | 停止；不能回退开发环境                                         |
| 在已核验开发环境做普通调试写入                  | 在应用授权/数据边界内允许；涉及已有数据 schema 需明确授权      |
| 开发授权被用于生产迁移                          | 不通过；必须生产目标与操作授权，平台审批仍独立                 |
| Worker 无隔离或 Worktree 被拒绝                 | 停止；不得写主工作区或换工具绕过拒绝                           |
| 把静态 toast 当作保存成功                       | 不通过；未验证真实流程必须 source/UI 标记原型                  |
| 旧 ADR 的当前路径与更晚领域决策冲突             | 报告冲突、保留有效边界；不凭旧路径恢复删除的业务能力           |

这些是规则文本的推演，不是工具、数据库或应用运行验收。

## 6. Migration Integrity

### 6.1 迁移事实

- 四份旧 `.mdc` 在当前工作区均不存在，相对 HEAD 显示删除；四份新 Markdown 均存在且未跟踪。迁移已落到工作区，尚未提交。
- 根发现入口已指向 `rules/`；不依赖旧 `globs/alwaysApply`。没有新增 Cursor/OpenCode/Zed 专属的规则内容副本。
- 检查 AGENTS、四份规则、DESIGN 和 ADR-001～009 共 **49 个本地 Markdown 文件链接**，目标均存在；此检查不等于 ADR 中每个历史源码路径都仍然有效。
- 搜索活跃入口、规则、产品/ADR/设计文档没有旧规则引用。剩余旧规则名称出现在 Phase 1 审计报告的当时来源表和处置记录；它没有被根入口作为当前规则加载，不应为迁移改写历史记录。
- DESIGN Diff 只有两处发现入口/职责文案调整。ADR-003～009 Diff 只替换旧规则引用及对应名称，未改变决策内容、状态或历史背景。
- 旧结构规则中的长 ledger/phase 步骤不再复制到各规则；所有权判定、Accepted 决策门、私有迁移例外、完整消费者覆盖和 failure scenario 检查仍明确存在。
- 未看到此次累计 tracked Diff 修改 Skills、业务源码、测试、依赖、hooks 或 DB migrations。

### 6.2 Phase 1、规则迁移和其他成果

| 分类            | 可确认事实与归因限制                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 背景    | `agent-rules-audit.md` 记录 test/dev/prod 分离、委派隔离和 local service 授权修订。这些主题已体现在当前根规则；无中间快照，不能把当前 AGENTS 全部差异归为 Phase 2B 新增 |
| 规则格式迁移    | 四份旧规则删除、四份新规则、根入口、DESIGN 两处及七份 ADR 引用替换，直接与迁移结构对应                                                                                  |
| 既有 PC-07 成果 | `public-categories-implementation.md` 有独立的运行验收/备份/迁移拒绝记录变更，进入本轮时已修改；未据此声称本轮验证了服务、数据库或备份                                  |
| 既有未跟踪成果  | `.pi-task-exec/` 与 `agent-rules-audit.md` 本轮开始时已经存在；未删除、修改或当作本轮新增                                                                               |
| MCP 配置删除    | `.cursor/mcp.json` 相对 HEAD 删除了七项 server 注册，包括 next-devtools、shadcn 和文档/Cloudflare 服务；本轮开始时已删除，当前证据不能确定它属于哪次操作或是否另有授权  |

因此，“未改 Skills/业务代码”可由当前 tracked Diff 支持；“未改 MCP”**不能对整个累计 Diff 成立**。这是一项范围归属待确认事实，不是已确认的未经授权修改，不计入缺陷数量，也不阻塞四份规则的发现与使用。

## 7. Findings

### P0 — Critical

无已确认问题。

### P1 — High

无已确认问题。

### P2 — Medium

#### F-01：Accepted ADR-008 仍将已退役 Admin 模块作为当前放置依据

- **位置：** `docs/adr/008-frontend-admin-feature-ownership-and-placement.md:83–103,181–191`；关联 `rules/architecture.md:46–53`。
- **证据：** ADR 仍为 Accepted；89、93 行将 `features/admin/works/**`、`features/admin/taxonomy/**` 和相应 routes 标为 current/verified，187、191 行继续要求新代码优先放入这些 owner。当前四个目录都不存在；`apps/web/features/admin/admin-taxonomy-route-absence.spec.ts:7–11` 明确要求旧 taxonomy page 不存在。ADR-001 的较晚有效修订（30、126–136 行）明确删除 Admin Work CMS，并将旧 Admin 描述标为历史。
- **影响场景：** Agent 按新架构规则读取 Accepted 所有权记录时，会得到与有效领域决策/当前实现不一致的放置依据。可能重复调查或停在冲突门，也可能误把退役模块当成应恢复的结构。
- **最小修复建议：** 后续仅给 ADR-008 中退役 Works/Taxonomy 段加明确历史/被替代标记，引用相应领域修订；去掉其“当前 owner”放置资格。保留仍有效的 AdminShell、public seam 和依赖方向决定，不重写整份 ADR，不据此恢复业务模块。
- **归因：** 以上正文在 HEAD 已存在。本次 Diff 只换规则引用；这是被发现链继续使用的既有文档漂移。
- **严重度理由：** 根规则与架构规则要求冲突报告，且较晚领域决策有明确入口，安全防线未消失；属于非阻塞的依据维护问题。

#### F-02：产品入口中的内容策略仍保留与有效领域契约冲突的限制/流程

- **位置：** `docs/product/content-strategy.md:100,123–129`；关联 `AGENTS.md:15–17` 和 `docs/product/README.md:11` 的发现入口。
- **证据：** 100 行把 `estimatedMinutes` 列为 Forbidden on Work，126 行写“加入书架 (ReadingState)”。ADR-001 的 60 行明确允许该派生统计，25–29、73–93 行明确 Library membership 与 ReadingState 分开。同一 content strategy 的 81、84 行也已经描述正确的分离。Shared Work schema 61、88 行及 DB schema 135 行拥有 `estimatedMinutes`；Library 测试 71、172–180 行检查移除 membership 保留 progress。
- **影响场景：** 按产品入口做字段或 Library 流程决策的 Agent 会读到相互矛盾的有效指引，可能误删契约字段或将 membership 重归 ReadingState。遵守冲突规则的 Agent 则需不必要地停止并再确认已接受的决定。
- **最小修复建议：** 后续只移除 `estimatedMinutes` 的错误禁止项，并将 Catalog 显式保存流程中的 membership 改为 UserLibraryItem/Library、保留 ReadingState 为阅读位置。链接 ADR-001 修订，不改实现或创造新的产品决定。
- **归因：** 两处文字在 HEAD 已存在，content strategy 未被本次迁移修改；不是四份新规则丢失约束。
- **严重度理由：** 有效 ADR、同文档正确定义、测试和源码都提供消歧依据，当前规则要求报告冲突；问题是依据的一致性与维护成本，未确认会直接破坏数据。

### P3 — Low

无需要列为缺陷的风格问题。行数口径、历史报告中的旧名、必要的局部原则重申和具体包名，不单独升级为问题。

## 8. Compatibility Assessment

本节基于 2026-10-12 读取的官方文档与仓库文件，结论是**按需发现方案合理**，不是完整运行验证。

| Agent    | 官方支持与当前方案判断                                                                                                                                                          | 限制                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Codex    | 支持沿项目 root 到 cwd 发现 AGENTS，结合全局/更近目录指引；根文件显式要求按任务读取四份规则，大小约 6.8 KiB                                                                     | 官方 AGENTS 发现链不等于自动扫描 `rules/` 或展开全部 Markdown 链接；未测具体宿主加载              |
| OpenCode | 官方 Rules 文档支持根 AGENTS，明确引用文件不自动解析，也给出 AGENTS 中要求按需 Read 外部规则的方案；当前入口具有这种指令                                                        | 未依赖 `opencode.json` 的全量导入，未验证各版本运行差异                                           |
| Zed      | 官方 Instructions 文档支持项目 AGENTS；它按候选文件优先顺序选择。仓库根未发现 `.rules/.cursorrules/.windsurfrules/.clinerules`、Copilot instructions 或 `AGENT.md` 等更优先入口 | 外部 Agent/Terminal Threads 使用自己的加载机制，不能笼统声称 Zed 控制所有 Agent；未做实际运行测试 |

官方依据：

- [OpenAI：Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [OpenCode：Rules，含 Referencing External Files](https://docs.opencode.ai/docs/rules/)
- [Zed：Instructions，含项目文件优先顺序与外部 Agent 限制](https://zed.dev/docs/ai/instructions)

适用范围均可从根任务入口和各规则开头判断。UI 有独立 DESIGN 入口；局部修改不需要读全部 ADR/规则。Frontend/Packages/Backend 在必要时指向 Architecture，Architecture 指回 package 专属政策；这些是条件交叉引用，不是要求无条件递归重读的加载循环。

没有必要为这轮兼容目标增加三套工具配置副本。能否实际遵守按需读取仍依赖 Agent 执行和宿主权限，不能由静态审查证明。

## 9. Review Gate

**PASS WITH FOLLOW-UPS。**

无已确认 P0/P1，关键规则发现链接有效，旧规则已从工作区退役，新规则可以按任务使用。两个 P2 来自既有依据文档漂移；它们没有使规则格式迁移不可用，也没有消除认证、数据隔离或授权保护。

这个结论不代表所有业务实现合规、PC-07 运行验收通过、所有 Agent 自动加载通过，或累计工作区中所有配置删除已经获得授权。

### 本轮验证与 Git 约束

- 49 个本地 Markdown 文件链接检查：通过。
- 四份规则计数、旧文件退役、入口/引用/竞争加载文件检查：完成。
- 新旧规则、安全与低风险开发场景的只读推演：完成，已区分实际代码和有效决定。
- 本报告的 Prettier Markdown 格式检查：通过；格式整理仅针对本报告。
- 报告完成后的 `git diff --check`：通过；另对未跟踪报告本身做格式和空白检查，避免将 Git 检查误认为已覆盖未跟踪文件。
- 与进入审查时 1181 个 tracked/untracked 路径的文件指纹/Git 状态比对：唯一变化为新增本报告；分支与 HEAD 不变，暂存区为空，既有成果未修改或清理。此比对不包括 ignored 运行缓存，也不代表其他工作树的全盘审计。
- 未暂存、commit、push、切换分支、创建工作树或改变 Git 配置。

## 10. Recommended Next Actions

1. 定点处理 F-01/F-02：使 ADR-008 的历史模块和 content strategy 的两处定义与有效领域决定一致；无需重写四份规则。
2. 在未来收拢迁移变更前，单独确认 `.cursor/mcp.json` 删除的归属和意图；不要把它混入“纯规则迁移、MCP 未改”的声明。
3. 结束规则结构重构。无需为这两项文档维护扩展业务重构、恢复旧工具规则、增加跨 Agent 配置或启动完整 E2E。

本轮只输出审查结果，未执行以上修复或进入下一阶段。
