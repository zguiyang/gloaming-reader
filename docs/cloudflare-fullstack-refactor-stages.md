# Cloudflare Full-Stack Refactor Stages（阶段与 P1 章程）

**Status:** Working plan（薄拆分；随证据修订）  
**Audience:** Humans and agents continuing the deploy/API topology refactor  
**Language:** Chinese (working decisions for this refactor)

> **本文用途：** 在北极星方向已定的前提下，约定**阶段顺序、门禁、P1 spike 范围**。  
> **本文不是：** 完整 PR 清单、生产切流授权、允许大规模删 `api`/`worker` 的执行令。  
> **上级文档：** [`cloudflare-fullstack-refactor-guidance.md`](./cloudflare-fullstack-refactor-guidance.md)（锁定项 L1–L8 与禁止项以它为准）。

---

## 0. 与其它文档的关系

| 文档                                    | 角色                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| 北极星 guidance                         | 方向与锁定；防跑偏                                     |
| [`AGENTS.md`](../AGENTS.md) + `rules/*` | 过渡期规范；当前态 vs 目标态                           |
| [`deployment.md`](./deployment.md)      | **当前**三服务运维现实（to-be-superseded）             |
| **本文**                                | 阶段顺序 + P1 章程；回答「下一步做什么、做到什么算完」 |

未决项（Free CPU、按需源能力、EPUB 重解析落点、Jobs/Queues）在 guidance §0.4；**禁止假装已定**。

### 0.1 正确顺序（防跑偏）— 维护者方案 2026-11-12

```text
对照 Workers 运行约束（选型与依赖纪律）
    → 旁路建 migration/（迁出暂存区；其内容将来提为新仓库根）
    → 其内：client 为主；jobs 空占位；自有 packages/与 workspace；暂不接 backend/jobs
    → 迁基础（Next 最新 + shadcn + 样式）→ 前端 → 后端进 client；共享包按 §4.1.1 处理
    → 迁入时换技术方案（AI SDK、TTS HTTP/REST、Workers 不友好依赖）
    → 迁得差不多后再瘦身旧 apps；最后新树才上 Workers（P4）
```

**禁止：** 拿当前 `web + Hono api + worker` 去证明「整包能否迁上 CF」。该拓扑不是迁移对象。  
**禁止：** 在旧树原地大改尚未建好新树时，就做「现网上 CF」兼容鉴定。  
**P1 绿场探针的唯一保留价值：** Next 在 Workers 上「有路可走」；**不是**现网三件套已可迁。

---

## 1. 阶段总览

```text
P0  规则对齐（消冲突）                 ✅ 已完成
P1  Next-on-Workers 前置可行性         ✅ 已完成（绿场探针；见 Appendix A）
P2  旁路新树 + 迁入切片 backlog        ✅ backlog 已写入 §4；执行仍需逐片授权
P3  migration/ 建树 → 迁前端 → 迁后端 → 瘦身  ← N3∥N4 本地切流已就绪；N5 另授权
P4  `client/` 上 Workers 真实兼容       🔄 P4-V1 进行中（vinext 构建 + Preview 薄路径）
```

| 阶段   | 目的                                              | 产出                                   | 明确不做                         |
| ------ | ------------------------------------------------- | -------------------------------------- | -------------------------------- |
| **P0** | AI/人不再按「永久三服务」惯性改                   | 规范与交叉引用已入库                   | 不改业务代码                     |
| **P1** | 证明 Next 在 Workers 工具链上能冒烟（前置）       | 冒烟记录、适配链倾向、已知 blocker     | 不切生产；不证明现网三件套可迁   |
| **P2** | 把「`migration/` + 迁入 + 换方案」切成有门禁任务  | 切片 backlog + 每片通过标准            | 不发明未决项结论；不做提前平台迁 |
| **P3** | 旁路 `migration/`、迁 UI/API、换方案、再瘦身      | 可运行的 `migration/client` 与对照策略 | 不把「上 CF 冒烟」当本阶段主线   |
| **P4** | 对 **`migration/` 新结构**做 Workers 真实兼容验证 | 平台结论（Free / Paid / 再降复杂度）   | 不对未迁完的旧三件套做兼容鉴定   |

**P3 本地进度（2026-11-12）：** N0–N2 脚手架/壳已落地；本波完成 **N3∥N4 本地切流**——`client/` 含全量 UI + Next Route Handlers（无嵌 Hono）+ 同包 BullMQ worker 第二进程；T1（AI SDK）/ T2（Azure Speech REST）在迁入路径生效。巩固波：对照表 [`PROCESS_COMPARE.md`](./PROCESS_COMPARE.md)、T3 清单 [`T3-DEPENDENCY-INVENTORY.md`](./T3-DEPENDENCY-INVENTORY.md)、限流 [`RATE_LIMIT.md`](./RATE_LIMIT.md)、assist tools 已接 AI SDK。详见 [`LOCAL_RUN.md`](./LOCAL_RUN.md)。

**N5（2026-11-12）：** 根 `apps/*` 与根 `packages/*` 已迁至 **`archive/`**；**step ③ 根提升已完成**（`migration/` 信封已取消）。

**Packages inline（2026-11-12）：** 根 `packages/i18n` + `packages/shared` 已收进 **`client/i18n/`**、**`client/shared/`**；根 workspace 仅 **`client`**。**未做：** R5 Jobs 终态书面定案。

**P4-V1（2026-11-12）：** 对象 **`client/`**（非 `migration/client`）。`vinext init --platform=cloudflare` + `pnpm build:workers` 本地通过；非生产 Preview `p4-v1-smoke` 已部署。详见 [`research/cf-workers-p4-v1-findings.md`](./research/cf-workers-p4-v1-findings.md)。**未做：** P4-V2 鉴权/DB/Free CPU 实测。

---

## 2. P0 — 规则对齐（已完成）

**完成含义：** 过渡期规范包已写入仓库（`AGENTS.md`、`rules/backend|frontend|architecture|packages.md`、`deployment.md` 状态栏、guidance Related）。

**检查：** 冲突时拓扑/API 归属以 guidance 为准；产品禁区与安全仍遵 `AGENTS.md`；`deployment.md` 不得被读成目标态。

---

## 3. P1 — Next-on-Workers 前置可行性（章程；已执行）

### 3.1 一句话目标

> 在**隔离实验面**用**最小新建** Next 探针验证：Workers 适配链能否构建/启动；**证明平台前置条件**，**不**把现网迁上去，**不**要求用当前 `apps/web` 做兼容鉴定。

### 3.2 要回答的问题

1. 选哪条适配路径先能冒烟：**OpenNext** 还是 **vinext**（或二者都失败 + 原因）？
2. 本地构建 + preview（或 `wrangler dev` 等价）能否跑通最小页面 + 至少一个 Route Handler？
3. （可选、需人授权账号）**非生产** Preview 上，**探针**轻路径是否出现 **1102**？（**不**代替重构后的真实鉴权/DB 验证——那是 **P4**）
4. 相对当前仓库，哪些依赖/形态是**重构时必须先消掉**的 Workers 不友好项（原生 Speech SDK、BullMQ 常驻、独立 Hono 进程、重 Node API 等）？——记为重构输入，**不在 P1 修完**。

### 3.3 范围内

- 新建**隔离**工作区/分支上的**最小** Next-on-Workers 绿场探针（推荐；合入需另授权）。
- 安装/配置实验所需的 OpenNext 或 vinext + Wrangler（仅实验面）。
- 本地构建与 preview / `wrangler dev`（或文档推荐等价命令）冒烟。
- 书面记录：命令、日志摘要、通过/失败、对重构（P2/P3）有约束意义的 blocker。
- 若维护者**明确授权** CF 账号与非生产环境：一次 Preview/临时 Worker 部署；测完可销毁。

### 3.4 范围外 / 禁止

| 禁止                                                      | 原因                         |
| --------------------------------------------------------- | ---------------------------- |
| 生产域名切流或替换现网三服务                              | 非 spike                     |
| 删除或停用仓库默认的 `api` / `worker` 交付路径            | 需 P3+ 授权切片              |
| 把嵌 Hono 写成终态并合入主线                              | 违反 L1                      |
| 默认上 Workers AI 做 TTS/LLM                              | 违反 L5/L6                   |
| 为 spike「顺便」迁完整 API、换 AI SDK、改 Discover 主路径 | 范围膨胀                     |
| 用现网三件套做「能否上 CF」的兼容证明                     | 对象错误；形状未重构前无意义 |
| 把本地/轻路径能跑写成「Free 配额一定够」                  | 概念偷换；真实路径属 P4      |
| 提交 secrets、扩大 secret 可见范围                        | 安全                         |

### 3.5 建议执行顺序（历史）

1. **读** guidance §0 + 本文 §3；确认实验面路径（worktree/分支）。
2. **本地**：选 OpenNext 或 vinext 之一先试；失败则换另一条；记录对比。
3. **最小绿场路径**：静态/SSR 页 + 一个轻量 Route Handler；不强行挂现网 backend。
4. **记录 blockers**（作为 P3 重构输入，不必在 P1 修完）。
5. **可选 Preview**：仅在人授权非生产账号后；只证明探针可部署。
6. **退出 P1**：写入 findings → 进入 **P2 重构 backlog**（不是进入「现网上 CF」）。

### 3.6 通过 / 失败标准

| 结果                            | 标准                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 通过（可进 P2 重构规划）** | 至少一条适配链在本地可重复构建并启动；有书面 blocker（重构输入）；OpenNext vs vinext 有倾向或「双败 + 原因」；未合入禁止项；未切生产。 |
| **P1 部分通过**                 | 本地可跑但 Preview 未测或网络受限——仍可写 P2；**不得**把「未测 Free」解读成必须立刻对现网做 CF 兼容检查。                              |
| **P1 失败（暂停平台目标假设）** | 两条适配链均无法在合理时间内冒烟——暂停「Workers 为平台目标」的默认假设，回到方案或平台选择讨论；**仍可**先做与平台无关的架构瘦身。     |

### 3.7 人工授权点（P1 内）

- 创建/使用 CF 账号、付费档、或任何云资源：**需要明确授权**。
- Preview 部署与销毁：**需要明确授权**（目标环境 + 保留时长）。
- 将实验配置**合入**共享默认分支：**需要明确授权**。

### 3.8 P1 非目标（再次强调）

- 不是验证「整站业务在 CF 上已等价现网」。
- 不是验证「当前 `web+api+worker` 能否迁上 Workers」。
- 不是批准开始大规模 Route Handler 迁移（迁移/重构属 P3，需另授权）。
- 不是决定 Jobs / Queues / EPUB 重解析终态。

---

## 4. P2 — 旁路新树 + 迁入切片与门禁（backlog）

**Status:** Backlog revised 2026-11-12（维护者方案：先建新结构再迁入，再瘦身；最后上 CF）  
**依据：** guidance L1–L8 / §0.4；[P1 findings](./research/cf-workers-p1-findings.md)。

### 4.1 维护者方案（整理稿）

| 原则           | 含义                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旁路信封       | 仓库根下建 **`migration/`**：迁出**暂存区**。迁入期间对照旧 `apps/*` / `packages/*`；**将来把 `migration/` 内的内容提取为新仓库根**（信封目录名本身不必进新产品名） |
| 旧树不动       | 保持现有 `apps/web`、`apps/backend`、根 `packages/*`、根 workspace **现状可跑**，便于对照、防漏改                                                                   |
| 本阶段新树要有 | 自有 **pnpm workspace** + **`client`**（最新 Next + shadcn；将来 UI+API）+ 自有 **`packages/`**（见 §4.1.1）                                                        |
| Jobs           | 同包面：`client/jobs/`（入口+处理器）；**非** `migration/jobs/` 旁路占位；非默认 CF 拓扑（R5）                                                                      |
| Backend        | **暂不**在新树建独立 backend/worker 包；API 后续进 `client`                                                                                                         |
| 迁入顺序       | ① Next+shadcn+样式基础 → ② 前端 → ③ 后端进 `client` → ④ 再瘦身旧交付                                                                                                |
| 依赖纪律       | 不装 LangChain → AI SDK（L6）；TTS → Azure Speech REST/HTTP（L5）；审查 Workers 不友好依赖（T3）                                                                    |
| 平台           | **P4** 才上 Workers；现在不做                                                                                                                                       |

**落盘形状（已定名 `migration/`；顺序不可反）：**

```text
<repo>/                              # 现有 monorepo（对照源；暂不拆）
  apps/web | apps/backend
  packages/shared | db | i18n        # 旧共享包：继续服务旧 apps
  pnpm-workspace.yaml                # 旧 workspace：不要为了新树去改坏旧安装面
  …
  migration/                         # ★ 迁出暂存区 → 将来整体内容 = 新仓库根
    package.json
    pnpm-workspace.yaml              # 只覆盖 migration 内包（自包含，便于提取）
    pnpm-lock.yaml                   # 与根 lockfile 分离（过渡期双 lock 可接受）
    client/                          # Next 最新 + shadcn；目标 UI + 全部 HTTP API
      app/                           # 路由组 + app/api（薄运输；N4 已填）
      features/ | components/ | lib/ # UI 分层（对齐 apps/web；N3 已填）
      shared/                        # ★ 应用内 UI↔server 契约（非 packages）
      server/                        # domains | infra | application | db（内化）| worker.ts
      constants/ | public/
      STRUCTURE.md                   # 目录约定与依赖方向
    packages/                        # 过渡：shared + i18n；**无** packages/db（schema 在 client/server/db）
                                     # Jobs 面：`client/jobs/`（同包第二进程；非默认 CF 拓扑；R5 仍开）
    LOCAL_RUN.md                     # 本地双进程跑通说明
    （eslint/prettier/tsconfig 等共享配置：在 migration 内自备副本或可提取的根配置）
```

应用内 `client/shared/` 与跨包 `packages/*` 的分工见 [`client/STRUCTURE.md`](../client/STRUCTURE.md)。

#### 4.1.1 共享包与共享配置（必虑）

现网有根级 `@gloaming/shared` / `@gloaming/db` / `@gloaming/i18n` 与根级 eslint/prettier/`tsconfig.base` 等。新树要能**对照旧实现迁**，又要能**整包提取成新仓库**，约定：

| 策略                     | 做法                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **默认：新树自包含**     | `migration/` 使用**自己的** workspace + lockfile；提取时拷走 `migration/**` 即可成新根，不依赖外层 monorepo 路径                                                                                                                                                                           |
| **旧 packages 只读对照** | 迁功能时对照根 `packages/*` 与 `apps/*`；**不**在迁入中期让旧 apps 改依赖到 `migration/packages`（避免双向纠缠）                                                                                                                                                                           |
| **共享包落点**           | 仍是跨 client（及将来 jobs）边界的契约/DB/i18n → 放进 `migration/packages/*` 并保持权威源在新树；**仅 client 内 UI↔server 共用**的契约 → 放 `client/shared/`；其它仅 client 使用且无第二消费者的代码可先放 `client` 内，证明复用后再提升到 `migration/packages`（L8：部署合并 ≠ 糊掉边界） |
| **迁共享包节奏**         | N0 可只建空 `migration/packages/` 或最小 stub；N2–N4 按真实 import **按需拷贝/改写**进新树，并切到 AI SDK / TTS REST / 去 Workers 不友好依赖；禁止「新 client 长期 `file:../../packages/shared` 指回旧树」作为终态（提取会断）                                                             |
| **共享配置**             | eslint / prettier / tsconfig / DESIGN 相关 token：**在 `migration/` 内放可提取副本**（可从根复制起步）；过渡期允许暂时 extends 根文件，但 N5/提取前必须收束到 migration 内                                                                                                                 |
| **双 workspace**         | 根 workspace 仅仓库工具；产品 workspace 在 **`migration/`**（N5 demote 后根脚本默认 `pnpm --dir migration …` 或根脚本转发）                                                                                                                                                                |

**N0 不做的事：** 改坏根 `pnpm-workspace.yaml` 导致旧 `apps/web|backend` 装不了；把 Jobs/BullMQ/Hono 独立服务接进 `migration/`。

### 4.2 怎么读「门禁」

门禁 = 该切片**开工前 / 合并前**的 go/no-go。  
服务的是：**新树是否按约定长出来、迁入是否换了方案、是否还把旧三件套当 CF 迁移对象**——**不是**「现在现网能否上 CF」。

### 4.3 全局约束

| 约束     | 说明                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 并存     | 旧 `apps/*` 在迁入完成前默认保留可跑；切换默认交付需另授权                                                     |
| 设计输入 | 对照 Workers 约束选型；依赖审查贯穿 N2–N4                                                                      |
| 禁止终态 | 嵌 Hono；默认 BullMQ 常驻为开源推荐；全量 Gutenberg 主路径；默认 Workers AI                                    |
| 边界     | 部署合并 ≠ 逻辑糊进 UI；`@gloaming/shared` / `@gloaming/db` 保留（L8）                                         |
| 生产     | 默认不碰；需要时单独授权                                                                                       |
| **禁止** | 现网三件套 CF 兼容检查作为下一刀；新树一上来就接 Jobs/常驻 worker；`client` 终态长期 file: 指回根 `packages/*` |

### 4.4 切片 backlog

#### A. 结构与迁入（主线，先做）

| ID     | 切片                  | 目的                                                                              | 依赖                     | 触碰面                                      | 验证 / 通过标准                                                           | 回滚 / 并存         | 门禁                            |
| ------ | --------------------- | --------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- | ------------------- | ------------------------------- |
| **N0** | `migration/` 脚手架   | 建自包含 workspace、`client/`、空 `jobs/`、空或最小 `packages/`；**不**接 backend | P1                       | `migration/**`、自有 lockfile               | `pnpm --dir migration install` 成功；根旧 apps 安装/启动面未被破坏        | 删整个 `migration/` | 遵循 §4.1.1；不改坏根 workspace |
| **N1** | Next 最新 + shadcn    | `migration/client` 可跑空壳；组件基线就绪                                         | N0                       | Next、`components.json`、基础 layout        | client dev/build 通过；shadcn 可加组件                                    | 丢弃 client 内容    | 对齐既有 DESIGN/UI 方向         |
| **N2** | 迁基础样式与前端壳    | 样式 token、全局样式、壳布局 → `migration/client`                                 | N1 ✅                    | CSS/tokens、layout、providers、route groups | 可对照 `apps/web`；壳可 build；业务页可为占位（**已完成骨架**）           | 旧 web 对照         | 不借机改产品语义                |
| **N3** | 迁前端功能            | UI/feature → `migration/client`（可多 PR）                                        | N2 ✅                    | `apps/web` → `migration/client`             | 约定页可演示；同源 `/api`（**本地整栈已对齐页面/feature**）               | 旧 web 并存         | 迁入清单；不做 CF 完成标准      |
| **N4** | 迁后端进 client       | API → Route Handlers；按需迁 `migration/packages`                                 | N3 足够进度 ✅           | `apps/backend` → client server + packages   | 契约/双跑；无嵌 Hono 终态（**本地 Route Handlers + 同包 worker 已接线**） | 旧 api 并存         | L1；T1–T3；密钥不进客户端       |
| **N5** | 瘦身旧交付 + 提取准备 | 旧 apps 降级；`migration/` 配置收束到可整包提取                                   | N4 差不多 + **明确授权** | 根脚本、`deployment.md`、migration 内配置   | 默认可切到新树叙事；提取清单齐                                            | 文档/分支可回滚     | 无授权不删默认三服务            |

#### B. 技术方案与依赖（迁入时强制，可与 N2–N4 同 PR 纪律）

| ID     | 切片                                       | 目的                                                              | 何时                                                                                                                                          | 门禁                                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **T1** | AI：LangChain → Vercel AI SDK              | 新树**不引入** LangChain；assist 用 `ai` + `@ai-sdk/openai`（L6） | ✅ 迁入路径已切（旧 LangChain 仅 `_legacy_hono` 对照）                                                                                        | 不默认 Workers AI；保留「解析模型行 → OpenAI 兼容 HTTP」外壳若仍需要 |
| **T2** | TTS：原生 SDK → Azure Speech **REST**/HTTP | `fetch` + SSML（L5）                                              | ✅ `server/infra/tts` REST                                                                                                                    | 不默认 Workers AI；密钥仅服务端                                      |
| **T3** | Workers 不友好依赖审查                     | 列出并替换/隔离原生 Node、长驻、不兼容 edge/Workers 的库          | 清单已写 [`migration/T3-DEPENDENCY-INVENTORY.md`](../migration/T3-DEPENDENCY-INVENTORY.md)；本地仍用 BullMQ 第二进程；**未**宣称 Workers 就绪 | 未处理项不得假装「已可上 Workers」；上 CF 仍属 P4                    |

#### C. 产品路径（可并行调研，合入不抢 N0–N3）

| ID     | 切片            | 目的                                              | 门禁                          |
| ------ | --------------- | ------------------------------------------------- | ----------------------------- |
| **R4** | Discover 按需   | L3；源无按需则改范围                              | 禁止偷回全量 Gutenberg 主路径 |
| **R5** | Jobs 策略书面化 | 本地：`client/jobs/` 同包第二进程；CF Queues 仍开 | 不假装 Queues/EPUB 落点已定   |

#### D. 平台（后置）

| ID        | 切片                                 | 何时          | 说明                     |
| --------- | ------------------------------------ | ------------- | ------------------------ |
| **P4-V1** | **`client/`** → Workers 构建/Preview | N5 根提升之后 | 对象是新树，不是旧三件套 |
| **P4-V2** | 真实鉴权/session/DB 与 Free CPU      | P4-V1 前后    | P1 探针不能代替          |

**明确后置：** EPUB 重解析落点；是否启用 Jobs / CF Queues。

### 4.5 推荐开工顺序

1. **N0 → N1 → N2 → N3**（结构与前端）
2. **N4**（后端进 client）+ 全程 **T1/T2/T3**
3. **N5**（瘦身旧树，需另授权）
4. **P4-V1 / P4-V2**（Workers 真实兼容）

### 4.6 已撤销的错误项（勿复活）

| 旧做法                                            | 为何撤销                                 |
| ------------------------------------------------- | ---------------------------------------- |
| 对真实 `apps/web` 做 vinext/CF 兼容检查作为下一刀 | 对象错误；应先建 `migration/client` 再迁 |
| 在旧 `apps/web` 原地先把 API 融进去再谈新目录     | 与「先旁路 `migration/`」冲突            |
| 重构前测现网鉴权 Free CPU                         | 形状与实现未换，结论不可外推             |
| 新树一上来接 Jobs/BullMQ                          | 与「jobs 仅占位、本阶段不用」冲突        |
| 新 client 长期 `file:` 依赖根 `packages/*`        | 提取成新仓库根时必断；违反 §4.1.1        |

### 4.7 P2 完成定义

- 本文 §4 被维护者认可（信封名已定为 `migration/`；不可偷偷改回「先上 CF / 先动旧三件套兼容」）。
- 每一刀 P3 写明切片 ID、授权范围、验证方式（默认在 **`migration/client` 本地**验证）。

---

## 5. P3 — 执行（尚未开始）

仅在对应 **N\*/T\*** 切片被授权后进行。遵守 guidance 与 `AGENTS.md`。  
**不要**把「部署到 Workers 冒烟」当成 N0–N4 完成标准。

部署合并 ≠ 逻辑糊进 UI；`migration/packages` 与 client 内模块边界按 §4.1.1 / L8 处理。

**建议第一刀（待维护者点头）：N0 + N1** — 建 `migration/` 自包含 workspace、`client` 上最新 Next + shadcn、空 `jobs/`；旧 apps/根 packages 不动；不上 CF。

---

## 6. P4 — 平台迁与真实兼容性（迁入差不多之后）

**前置：** N5 后产品根为 **`client/` + `packages/`**（`migration/` 信封已取消）。  
**对象：** **`client/`** 新结构，**不是** `archive/` 旧 `web+api+worker`。  
**内容：** Workers 构建/Preview、关键路径、鉴权/DB 与 Free CPU（P4-V1/V2）。  
**禁止：** 用旧三件套或 P1 探针冒充 P4 证据。

**P4-V1 状态（2026-11-12）：** 进行中 — vinext 并存路径已入库（`client/vite.config.ts` 等）；`pnpm build:workers` 冒烟；Preview 见 [P4-V1 findings](./research/cf-workers-p4-v1-findings.md)。默认交付仍为 `pnpm dev` + `pnpm jobs`（Node）。

---

## 7. 修订规则

- 改 L1–L8 或禁止项 → **先改 guidance 并经人确认**。
- 仅调整阶段顺序、P1 范围、门禁措辞 → 改本文并简短说明原因。
- Spike 结论与本文冲突 → 更新附录；必要时提请修订 guidance。
- **顺序原则变更**（如「先平台兼容后重构」）→ 必须经维护者确认后再写回本文。

---

## Appendix A — P1 findings

详细记录：[research/cf-workers-p1-findings.md](./research/cf-workers-p1-findings.md)

| 项                          | 结果                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 日期                        | 2026-11-12                                                                                                                                                   |
| 适配链（OpenNext / vinext） | **vinext** 绿场探针通过；未测 OpenNext                                                                                                                       |
| 本地构建/dev                | `vite build` + `vite preview` 通过（`/`、`/api/hello`、`/api/smoke`）                                                                                        |
| Preview / Free CPU / 1102   | Preview 部署成功；浏览器访问探针路径 **无 1102**。本机 CLI 对 `*.workers.dev` 443 超时（网络路径问题，≠ CPU 失败）。**未**证明真实登录/DB；真实路径属 **P4** |
| Blockers（迁入输入）        | 现网三服务、Hono、BullMQ、原生 Speech SDK、LangChain、重 Node——在 **新 `client` 迁入时用 T1–T3 / N4 消除**，不是「先证明旧树能上 CF」                        |
| 对后续的建议                | 信封目录 **`migration/`**（自包含 workspace）；**N0–N3** 迁前端 → **N4** 迁后端 → **N5** 瘦身/可提取；共享包见 §4.1.1；T1–T3；Workers → **P4**               |

## Related

- 北极星：[cloudflare-fullstack-refactor-guidance.md](./cloudflare-fullstack-refactor-guidance.md)
- 当前部署现实：[deployment.md](./deployment.md)
- Agent 过渡期：[../AGENTS.md](../AGENTS.md)
