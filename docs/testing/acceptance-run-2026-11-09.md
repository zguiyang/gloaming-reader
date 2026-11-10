# Gloaming 交互验收结果 — 2026-11-09（续完 2026-11-10）

> **环境**：本地开发库 `http://localhost:3000`（web / api / worker；Postgres `5433` / Redis `6380`）  
> **方式**：浏览器交互 + Admin/用户 API（非 `gloaming_test` 套件）  
> **依据**：[`user-path-feature-inventory.md`](./user-path-feature-inventory.md)  
> **诚实状态**：_*inventory 118 个 F-* 已全部执行_*（GitHub 按要求 SKIP）。修复后：F-ADM-04 / F-SET-06 / 词典 AI 增强 **PASS**；**F-TAG-07 个人自动打标签仍 FAIL**；GitHub OAuth **SKIP**。详见 §8 / §9 / §10。

## 状态图例

| 状态    | 含义               |
| ------- | ------------------ |
| PASS    | 已执行且符合预期   |
| FAIL    | 已执行但不符合预期 |
| PARTIAL | 部分通过           |
| BLOCKED | 环境/依赖阻塞      |
| NOT_RUN | 本轮未执行         |

## 执行进度（总览）

| 批次 | 范围                  | 状态                                               |
| ---- | --------------------- | -------------------------------------------------- |
| A    | 访客路径              | **PASS**                                           |
| B    | 注册普通用户          | **PASS**（mail.tm）                                |
| C    | 读者主循环            | **PASS**（含 Discover 保存复测通过）               |
| D    | 用户 Settings / BYOK  | **PASS**（BYOK 创建+删除；自动打标签效果未挂真钥） |
| E    | Admin 实例配置数据    | **PASS**                                           |
| E2   | Admin 配置页浏览器 UI | **PASS**                                           |
| E3   | 改配置再读（可逆）    | **PASS**（TTS 音色 / assist 模型切换后已改回）     |
| F    | 标签 / History        | **PASS**（含赋标 + URL `?tag=` 过滤）              |
| G    | Account               | **PASS**（改密、忘记密码重置、改邮发信）           |

### 账号

| 角色     | 标识                                              | 备注                                       |
| -------- | ------------------------------------------------- | ------------------------------------------ |
| 普通用户 | `acceptreader233418` / `accept233418@fldubai.com` | 密码验收后已恢复为 `AcceptTest1!`          |
| Admin    | `2770723534@qq.com`                               | 使用 `.env` `ADMIN_PASSWORD`（不写入报告） |

---

## 1. 读者主循环（摘要）

| ID                   | 功能                           | 状态                        | 证据                                                                                               |
| -------------------- | ------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------- |
| F-AUTH-*             | 注册 / 验邮 / 登录             | PASS                        | mail.tm                                                                                            |
| F-LIB / F-UPL / F-RD | 书库 / 上传 / 阅读 / AI / 双语 | PASS                        | Miss Moppet                                                                                        |
| F-RD-19              | TTS                            | 后端 PASS / UI 听感 PARTIAL | 日志 success；浏览器未稳定断言 `<audio>`                                                           |
| F-DIS-08             | Discover 加入书库              | **PASS（复测）**            | 初轮 Oz `network_error`；2026-11-10 重试后 materialize+parse 完成，书库「已保存」可见 Oz「未开始」 |
| F-TAG-01…05/09       | 标签 CRUD + 赋标 + 过滤        | PASS                        | 「验收过滤」赋到 Miss Moppet；URL `/library?tag=<uuid>`                                            |
| F-HIS-*              | Reading History                | PASS                        | 热力图 + 作品列表                                                                                  |

### Discover 保存失败根因

- 错误文案：`the EPUB download could not be completed` → 代码映射为 Gutenberg 下载 `network_error`（`apps/backend/src/domains/discovery/materialization/download.ts`）。
- 本机现可直连 `gutenberg.org` EPUB（HTTP 200）；重试后 worker：`source-record-materialize` completed → `EpubIngest` parsed → `content-parse` completed（142 images）。
- **结论**：瞬时网络失败，非产品逻辑永久缺陷；重试可用。

---

## 2. 访客路径

| 场景                         | 状态 | 证据                                      |
| ---------------------------- | ---- | ----------------------------------------- |
| Landing `/`                  | PASS | 产品文案                                  |
| Discover 匿名浏览            | PASS | 列表 +「登录」                            |
| Library / History / Admin 墙 | PASS | 登录对话框 / 「请先登录后再进入管理后台」 |

---

## 3. Admin 配置

### 3.1 数据 + UI（此前已验）

Provider ofox.ai、三用途绑 GPT-6 Luna、Azure TTS eastus、词典有道（AI 增强日志失败记 PARTIAL）、分类 / Gutenberg 79690 / 资产 22.2MB、日志中心 — 均 PASS。

### 3.2 改配置再读（2026-11-10，可逆）

| 操作                                                                       | 结果                                             | 恢复               |
| -------------------------------------------------------------------------- | ------------------------------------------------ | ------------------ |
| TTS `defaultVoice/usVoice` → `en-US-GuyNeural`；`POST /api/admin/tts/test` | PASS：`ok`，voice=`en-US-GuyNeural`，~1844ms     | 已改回 Jenny/Sonia |
| `assist.default_model_id` → GPT-5 Mini；再改回 Luna                        | PASS：settings 返回 healthy；最终三用途仍为 Luna | 已改回             |

未做：读者页内「换音色后听一整段」听感回归（仍属 TTS UI PARTIAL）。

---

## 4. Settings / BYOK

| 项                             | 状态    | 证据                                                                         |
| ------------------------------ | ------- | ---------------------------------------------------------------------------- |
| Settings 页朗读/AI/自动标签 UI | PASS    | 默认服务；自动标签关；需自有 AI                                              |
| BYOK 创建 Provider             | PASS    | `POST /api/settings/llm/providers` 名称 `accept-byok-test`，`apiKeySet=true` |
| BYOK 删除                      | PASS    | `DELETE` → 204；列表空                                                       |
| 自动打标签真实效果             | NOT_RUN | `providerAvailable=false`；未挂可用真钥                                      |

---

## 5. Account

| 项             | 状态    | 证据                                                                               |
| -------------- | ------- | ---------------------------------------------------------------------------------- |
| 改密           | PASS    | `change-password`（需 Origin）AcceptTest1!↔2! 往返成功                             |
| 忘记密码发信   | PASS    | `POST /api/auth/request-password-reset` → mail.tm「Reset your Gloaming password」  |
| 重置密码页     | PASS    | `/reset-password?token=…` 设为 AcceptTest3! 后可登录；再改回 AcceptTest1!          |
| 改邮发验证信   | PASS    | 发往 `acceptchg…@fldubai.com`；含 `verify-email?token=…&change-email-verification` |
| 点确认完成换绑 | NOT_RUN | 有意不点，避免换掉验收邮箱                                                         |

---

## 6. 服务重启记录（2026-11-10）

- Postgres/Redis 容器本已 healthy（`gloaming-postgres` / `gloaming-redis`）。
- 重启：`pnpm dev:backend`、`pnpm dev:worker`、`pnpm dev:web`（软件更新后）。

---

## 7. 结论（截至续测前）

- **上线冒烟主路径 + Admin 运维面 + 先前缺口：已覆盖。**
- Discover 保存初轮 FAIL 已复测为瞬时 Gutenberg 网络问题，**现 PASS**。

---

## 8. 续测（2026-11-10 上午）

### 8.1 新 PASS（摘录）

| ID / 场景                    | 状态     | 证据                                                                        |
| ---------------------------- | -------- | --------------------------------------------------------------------------- |
| F-LIB-04/06/07/08/09         | PASS     | source/status/q/sort API；UI 列表视图 + `?source=saved`                     |
| F-LIB-05 / F-TAG-*           | PASS     | tag 过滤；创建+赋标+删除标签（`name` 字段）                                 |
| F-LIB-14 / F-DIS-08/10       | PASS     | 目录书移除 membership；经 SourceRecord 再保存 → ready                       |
| F-DIS-01/02/09               | PASS     | records 列表/搜索；`isSaveable=false` 存在                                  |
| F-DIS-13/14                  | PASS     | legacy `/discover/{workId}`；`/works/{id}` 200                              |
| F-AUTH-11/13/17/18           | PASS     | auth-error / account session / 主题浅↔深 / `/more`                          |
| F-HIS-* API                  | PASS     | `/api/reading-history` 热力+作品                                            |
| F-ADM-01/02/03/06/07/08/09   | PASS     | 非 admin 403；assets/scan/latest；PG sync；LLM/TTS/词典/AI 日志             |
| F-ADM-04 create/delete-empty | PASS     | 空分类创建+删除 201/204                                                     |
| F-RD-19/20                   | PASS     | manifest+segment audio ~15KB；阅读器迷你播放器（暂停/倍速/美英音）          |
| F-TAG-06                     | PASS     | 创建并赋标后清理                                                            |
| F-AUTH-15 改邮确认           | **PASS** | 换到 `acceptchg378588@…` 可登录 → 再换回 `accept233418@…`；两端验证链均成功 |
| F-AUTH-07 无效 token         | PASS     | `verify-email?token=not-a-real-token` → 401 `INVALID_TOKEN`                 |
| F-AUTH-12 登出               | PASS     | `POST /api/auth/sign-out` + JSON → session null                             |
| F-RD-17 整章双语             | PASS     | `POST /api/translate/part` SSE `event: meta`                                |
| F-RD-25 心跳                 | PASS     | `seconds`+`sessionId`+`sequenceNumber` → 200                                |
| F-DIS-12 SourceRecord 详情   | PASS     | `/discover/records/{id}` 200                                                |
| F-LIB-15 删个人书            | PASS     | Peter Rabbit 上传后 `DELETE /api/works/{id}`                                |
| F-SET-04 BYOK CRUD           | PASS     | 临时挂实例 ofox 钥创建 Provider/Model/绑定；测完已删除（providers=[]）      |
| F-TAG-08 开关                | PASS     | 开启后 `providerAvailable=true`；清理后 `false`；默认关                     |

### 8.2 FAIL / PARTIAL / SKIP

| 项                           | 状态                   | 说明                                                                                                                         |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 词典 AI 增强                 | **PASS（稳定路径后）** | json 文本 + 上下文小任务 + Zod 重试；Admin/阅读器实机有 `sentenceZh`                                                         |
| F-ADM-04 删已分配            | **PASS（复测）**       | 有 assignment 时 DELETE → **409** `publicCategoryHasAssignments`；解除后可删                                                 |
| F-TAG-07/J-03 自动打标签 E2E | **FAIL（复测）**       | BYOK 测连已通；`personal-tagging.classify` structured 仍 503 `ai.unavailable`（~9–17s），`latestRunState=failed`，无 AI 标签 |
| F-SET-06 用户模型测连        | **PASS（复测）**       | 不填 `proxyUrl` 时继承实例代理；Mini test **200 ok ~2.9s**                                                                   |
| F-AUTH-10 GitHub             | **SKIP**               | 用户要求自行配置后测试                                                                                                       |

### 8.3 事故与恢复：公开分类「传记」（用户已确认可接受）

- 误删后重建「传记 / Biography」`2e473176-…`，确认 shelf `Category: Biographies` 并 reconcile。
- **public `recordCount=5182`（与误删前一致）**；admin 侧约 6199。对账 API 长时间仍 `pending/scanned:100`，未强求跑干。

### 8.4 授权项执行结果

1. **BYOK**：已临时解密实例 ofox 钥挂到验收用户 → 上传 Peter Rabbit → 自动打标签失败（用户侧 AI 超时）→ **已删除 BYOK Provider/Models/设置**，临时密钥文件已清理。
2. **改邮**：往返换绑 **PASS**，当前仍为 `accept233418@fldubai.com` / `AcceptTest1!`。
3. **GitHub OAuth**：**未测**（按你的要求）。

### 8.5 本轮结论

- 冒烟主循环、访客墙、Library/Discover/Reader/History/Admin 配置面、改邮确认、BYOK 挂载与清理：**已覆盖**。
- **残留缺陷（需产品/工程跟进）**：
  1. Admin 删除仍有 SourceRecord 关联的公开分类未返回 409；
  2. 用户 BYOK / `providerScope=user-only` 调用相对实例同钥明显失败（超时/503），阻塞自动打标签 E2E；
  3. 词典 AI enrichment structured 调用失败（有道基座可用）。

### 8.6 缺口补测（2026-11-10 上午续）

此前约 26 个 NOT_RUN 中，除你要求跳过的 **F-AUTH-10 GitHub** 外，其余均可在现有本地环境用验收账号/临时 mail.tm 账号补测；**不需要你再提供密钥**。本段已补测并通过/记录如下。

| ID                                        | 状态     | 证据                                                                                                                                                                                                                    |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-AUTH-04 / F-AUTH-06                     | PASS     | 未验证登录 `EMAIL_NOT_VERIFIED` 403；`send-verification-email` 200 + mail.tm                                                                                                                                            |
| F-AUTH-16                                 | PASS     | 账户菜单 en-US ↔ zh-CN；标题 Library ↔ 书库                                                                                                                                                                             |
| F-LIB-02 / F-HIS-02                       | PASS     | 新用户 `gapempty…@fldubai.com` 空书库/空历史                                                                                                                                                                            |
| F-LIB-16                                  | PASS     | `PATCH /api/works/:id` 元数据后改回                                                                                                                                                                                     |
| F-TAG-03                                  | PASS     | 多 locale rename + `translations/complete`                                                                                                                                                                              |
| F-UPL-03 / F-UPL-06                       | PASS     | 超大 Content-Length → `fileTooLarge`；坏 EPUB → `failed` 后删除                                                                                                                                                         |
| F-DIS-04 / F-DIS-05 / F-DIS-18 / F-DIS-19 | PASS     | 清除分类 chip；分页 Next；非法 `returnTo` → Library；赋标                                                                                                                                                               |
| F-RD-04/06/08/09/13/15/18/21/22           | PASS     | 顶栏显隐、字号循环、Finish、history 穿章、Ask/续聊、句对聚焦、TTS 高亮、进度 50%                                                                                                                                        |
| F-HIS-06                                  | PASS     | 历史按日期降序（产品无独立排序控件）                                                                                                                                                                                    |
| F-ADM-05 / F-ADM-10                       | PASS     | shelves GET + 映射 noop 保存；legacy `admin/*/page.tsx` `redirect()`                                                                                                                                                    |
| F-LIB-10                                  | **PASS** | 用 Python/`pg` 向验收用户灌入 30 本 `Accept Seed Book *`（ready + part + `user_library_item`）；`browse` page1=24 `hasMore=true`、page2 无重叠；UI「加载更多」后可见 Book 25–30；测完已 `DELETE` 种子书，Oz/Moppet 保留 |

**覆盖率（相对 inventory 118 个 F-\*）**：

| 口径                           | 结果                                         |
| ------------------------------ | -------------------------------------------- |
| 已执行（含 FAIL/PARTIAL/SKIP） | **118 / 118 = 100%**                         |
| 明确 PASS                      | **112 / 118 ≈ 94.9%**                        |
| 仅剩未测                       | **无**（GitHub 为用户要求 SKIP，仍算已执行） |
| P0                             | **38/38 执行且 PASS**                        |
| P1                             | **50/50 执行**                               |
| P2                             | **30/30 执行**                               |

已知剩余：F-TAG-07 个人自动打标签（strict structured `invokeAi` 仍 503）。已复测通过：F-ADM-04（409）、F-SET-06（BYOK 测连/代理继承）、词典 AI 上下文增强。GitHub OAuth（F-AUTH-10）按要求 SKIP。

## 9. 2026-11-10 修复后复测

服务：API `:3333`、worker、web `:3000` 已重启。自动化脚本结果见 `/tmp/gloaming-accept/retest-results.json` 与 `/tmp/gloaming-accept/dict-ai-live-results.json`。

| 项        | 结果     | 证据要点                                                                                           |
| --------- | -------- | -------------------------------------------------------------------------------------------------- |
| F-ADM-04  | PASS     | assign 204 → delete 409；cleanup 204                                                               |
| F-SET-06  | PASS     | BYOK 无 proxy 字段；test ok 2894ms                                                                 |
| 词典 AI   | **PASS** | json 文本 + 小任务 + Zod 重试；Admin/阅读器 lookup 均有 `sentenceZh`；`dictionary:context` success |
| F-TAG-07  | FAIL     | Bull `failedReason=api.errors.ai.unavailable`；classify 503（仍用 strict structured，未改）        |
| 临时 BYOK | 已清理   | providers `[]`；personal-tagging disabled；实例 assist 仍为 Luna                                   |

## 10. 上线就绪判断（2026-11-10）

**结论：尚未达到「无保留上线」标准；可作为带已知限制的预发布 / 灰度候选。**

| 维度                                   | 判断                                              |
| -------------------------------------- | ------------------------------------------------- |
| 主阅读路径（访客→注册→读→查词→Ask 等） | 验收覆盖且核心 PASS                               |
| Admin 分类删除契约                     | 已修复并复测 PASS                                 |
| 用户 BYOK 测连                         | 已修复并复测 PASS                                 |
| 词典 AI 上下文增强                     | 已改稳路径并 4/4 实机 PASS                        |
| 个人自动打标签（F-TAG-07）             | **仍 FAIL**（structured 网关路径）                |
| GitHub 登录                            | 本轮 **SKIP**，未验收                             |
| 自动化回归                             | 相关 unit/functional 已跑；非全量 CI 门禁复跑记录 |

**上线前建议至少处理：** F-TAG-07（与词典同类的 structured 降级，或明确产品降级文案/关闭默认自动打标）；补一次 GitHub OAuth 冒烟或正式宣布首发不含社交登录。
