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

---

## 1. 阶段总览

```text
P0  规则对齐（消冲突）           ✅ 已完成
P1  Workers 可行性窄 spike       ← 下一步执行面（先章程，再实验）
P2  迁移切片与门禁（可执行 backlog）
P3+ 按切片改代码（API 归属、TTS REST、AI SDK、按需 Discover…）
```

| 阶段    | 目的                             | 产出                                 | 明确不做                 |
| ------- | -------------------------------- | ------------------------------------ | ------------------------ |
| **P0**  | AI/人不再按「永久三服务」惯性改  | 规范与交叉引用已入库                 | 不改业务代码             |
| **P1**  | 用证据回答「Workers 是否够起步」 | 冒烟记录、工具选型倾向、blocker 列表 | 不切生产、不大搬家       |
| **P2**  | 把可做的迁移切成有门禁的任务     | 切片 backlog + 每片通过标准          | 不发明未决项结论         |
| **P3+** | 按授权切片落地目标拓扑           | 合并后的代码与验证                   | 不跳过门禁、不复活禁止项 |

---

## 2. P0 — 规则对齐（已完成）

**完成含义：** 过渡期规范包已写入仓库（`AGENTS.md`、`rules/backend|frontend|architecture|packages.md`、`deployment.md` 状态栏、guidance Related）。

**检查：** 冲突时拓扑/API 归属以 guidance 为准；产品禁区与安全仍遵 `AGENTS.md`；`deployment.md` 不得被读成目标态。

---

## 3. P1 — Workers 可行性窄 spike（章程）

### 3.1 一句话目标

> 在**隔离实验面**验证：Next 应用能否在 Cloudflare Workers 工具链上构建/启动，并记录关键路径与 Free 配额相关风险；**不**把现网迁上去。

### 3.2 要回答的问题

1. 选哪条适配路径先能冒烟：**OpenNext** 还是 **vinext**（或二者都失败 + 原因）？
2. 本地 `wrangler dev`（或等价）能否跑通最小页面 + 至少一个 server/route 入口？
3. （可选、需人授权账号）**非生产** Preview 部署后，登录或等价鉴权/会话路径是否出现 **1102 / Free CPU** 类失败？
4. 相对当前仓库，硬 blocker 是什么（原生 Speech SDK、BullMQ/常驻 worker、Hono 独立进程、Node 专用 API 等）？

### 3.3 范围内

- 新建或使用**隔离**工作区/分支；可建**最小** Next-on-Workers 探针，或对 `apps/web` 做**可丢弃**的适配试验（以不污染 `dev` 主线合入假设为准，合入需另授权）。
- 安装/配置实验所需的 OpenNext 或 vinext + Wrangler（仅实验面）。
- 本地构建与 `wrangler dev`（或文档推荐的等价命令）冒烟。
- 书面记录：命令、日志摘要、通过/失败、blocker、对 P2 的建议。
- 若维护者**明确授权** CF 账号与非生产环境：一次 Preview/临时 Worker 部署，只测门禁路径，测完可销毁。

### 3.4 范围外 / 禁止

| 禁止                                                      | 原因                 |
| --------------------------------------------------------- | -------------------- |
| 生产域名切流或替换现网三服务                              | 非 spike             |
| 删除或停用仓库默认的 `api` / `worker` 交付路径            | 需 P2+ 授权切片      |
| 把嵌 Hono 写成终态并合入主线                              | 违反 L1              |
| 默认上 Workers AI 做 TTS/LLM                              | 违反 L5/L6           |
| 为 spike「顺便」迁完整 API、换 AI SDK、改 Discover 主路径 | 范围膨胀             |
| 把本地能跑写成「Free 配额一定够」                         | 概念偷换；配额要实测 |
| 提交 secrets、扩大 secret 可见范围                        | 安全                 |

### 3.5 建议执行顺序

1. **读** guidance §0 + 本文 §3；确认实验面路径（worktree/分支）。
2. **本地**：选 OpenNext 或 vinext 之一先试；失败则换另一条；记录对比。
3. **最小路径**：静态/SSR 页 + 一个轻量 Route Handler（或现有 web 上极窄入口）；不强行挂全量 backend。
4. **记录 blockers**（相对本仓库真实依赖，不必在 P1 修完）。
5. **可选 Preview**：仅在人提供 CF 账号授权与「非生产」确认后进行；重点看鉴权/会话或约定的关键路径与 1102。
6. **退出 P1**：写入简短 findings（可附在本文附录或独立 `docs/research/` 笔记），再开 P2。

### 3.6 通过 / 失败标准

| 结果                      | 标准                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **P1 通过（可进 P2）**    | 至少一条适配链在本地可重复构建并启动；有书面 blocker 列表；OpenNext vs vinext 有倾向或「双败 + 原因」；未合入禁止项；未切生产。    |
| **P1 部分通过**           | 本地可跑但 Preview/Free 未测，或 Preview 显示关键路径不稳定——仍可写 P2，但 P2 必须把「Paid / 降路径复杂度 / 改关键路径」列为门禁。 |
| **P1 失败（暂停大迁移）** | 两条适配链均无法在合理时间内冒烟，或未授权就无法得到任何 Workers 运行证据——停止 P3+ 大搬家，回到方案或平台选择讨论。               |

### 3.7 人工授权点（P1 内）

- 创建/使用 CF 账号、付费档、或任何云资源：**需要明确授权**。
- Preview 部署与销毁：**需要明确授权**（目标环境 + 保留时长）。
- 将实验配置**合入**共享默认分支：**需要明确授权**（默认 spike 产物可留在分支/笔记，不自动进默认交付）。

### 3.8 P1 非目标（再次强调）

- 不是验证「整站业务在 CF 上已等价现网」。
- 不是批准开始大规模 Route Handler 迁移。
- 不是决定 Jobs / Queues / EPUB 重解析终态。

---

## 4. P2 — 迁移切片与门禁（尚未开始）

P1 有结论后再写细。预期内容（预告，不提前锁死）：

- 按风险切开的 backlog（例如：适配链入库 → 无状态 API 迁 Next → TTS 改 Azure REST → assist 改 AI SDK → Discover 按需 → 文档/交付拓扑切换）。
- 每片：依赖、触碰面、验证、回滚/并存策略、是否允许碰生产。
- 显式门禁：P1 未决项如何阻塞哪些切片。

---

## 5. P3+ — 执行（尚未开始）

仅在对应切片被授权后进行。遵守 guidance 禁止项与 `AGENTS.md` 过渡期规则。部署合并 ≠ 逻辑糊进 UI；`@gloaming/shared` / `@gloaming/db` 边界保留。

---

## 6. 修订规则

- 改 L1–L8 或禁止项 → **先改 guidance 并经人确认**。
- 仅调整阶段顺序、P1 范围、门禁措辞 → 改本文并简短说明原因。
- Spike 结论与本文冲突 → 更新本文附录/P2 预告，必要时提请修订 guidance。

---

## Appendix A — P1 findings（占位）

> P1 结束后在此填写，或改为链接到 `docs/research/` 下的笔记。

| 项                          | 结果                       |
| --------------------------- | -------------------------- |
| 日期                        |                            |
| 适配链（OpenNext / vinext） |                            |
| 本地构建/dev                |                            |
| Preview / Free CPU / 1102   | 未测 / 通过 / 失败（摘要） |
| Blockers                    |                            |
| 对 P2 的建议                |                            |

## Related

- 北极星：[cloudflare-fullstack-refactor-guidance.md](./cloudflare-fullstack-refactor-guidance.md)
- 当前部署现实：[deployment.md](./deployment.md)
- Agent 过渡期：[../AGENTS.md](../AGENTS.md)
