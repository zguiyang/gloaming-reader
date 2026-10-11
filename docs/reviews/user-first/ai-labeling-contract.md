# Gloaming AI 标签与分类合同（评审草案）

**文档状态：** 评审草案（review draft），非批准稿、非实现授权。**RECOMMENDED（建议）与 OPEN（开放）项均未获批准**；CONFIRMED 仅表示已捕获的用户决定或可证实的当前事实，不代表正式批准。不启动任何代码、schema、迁移、服务或模型调用。

**基线：** `dev-02` 工作区，含既有未提交评审文档。**本轮仅修订本文件**（不再声明为新增）；未新增或修改其他文件，未触碰 Git、数据库或 AI。

**证据标记：**

- **CONFIRMED**：用户已明确确认的合同条款，或当前源码/配置可证实的事实。
- **RECOMMENDED**：本草案建议值，尚未被用户确认为硬性上限。
- **OPEN**：真正未决的问题，需要用户后续决定。

规则强度用 **MUST / SHOULD / MUST NOT** 表达。CONFIRMED 条款可被后续用户决定覆盖，但不得被实现或文档默认翻转。

---

## 1. 文档定位与状态

- **[CONFIRMED]** 本文件是“AI 标签与公共分类”的评审草案，用于对齐产品语义与验收，不描述框架、表结构或服务实现。
- **[CONFIRMED]** **产品目标：** 以**准确的组织**帮助用户管理书库、让发现更容易；**MUST NOT** 以最大化标签/分类数量为目标，数量增长不是成功指标。
- **[CONFIRMED]** 本文件不改变既有评审报告、ADRs、schema、服务、路由或测试；不覆盖历史证据。
- **[CONFIRMED]** 本文件与旧评审文档冲突时，以本草案条款为当前目标意图，但历史文档保留（见 §11）；本草案未批准前，代码现状仍是当前事实。
- **[OPEN]** 本合同的最终批准流程、批准人与生效日期尚未记录。
- **[CONFIRMED]** 所有涉及数据库写入、迁移或 AI 调用的实现都必须另行获批；本文件本身不构成许可。

---

## 2. 当前事实（Present Reality）

- **[CONFIRMED]** 个人 **User Tags 已实现**：`user_tag(user_id, name, normalized_name)` 与 `user_work_tag(user_id, work_id, tag_id)`，按用户隔离、复合外键保证归属。见 [schema.ts](../../../packages/db/src/schema.ts#L199-L240)。
  - `user_tag` 当前只存**一个名称**（`name` / `normalized_name`），**没有** `localizedNames` 之类的多语言名称字段。
  - `user_work_tag` 当前**没有 provenance / 来源字段**，无法区分“标签创建来源”与“每本书关联来源”。
- **[CONFIRMED]** **描述增强（description enrichment）已实现**，且是当前字段注册表里唯一的 AI 字段。见 [fields.ts](../../../apps/backend/src/domains/metadata/enrich/fields.ts)。
- **[CONFIRMED]** 当前 metadata enrichment 的实际路径是 **Catalog-only**（面向 ownerless 的 Catalog Work）；它**不是** Personal EPUB 的自动打标路径。
- **[CONFIRMED]** **AI 标签生成、AI 分类、AI 自动整理当前不存在**：字段注册表只有 `description`；enrich 调用**未传 `userId`**，因此当前不能认定个人 BYOK 已接入标签流程。
- **[CONFIRMED]** 当前 `normalizeTagName` 为 ASCII-only，会把含 ASCII 数字的 `英语学习2` / `儿童文学2` 折叠成同一 key，可能合并本应区分的 CJK 名称；这是**已存在的实现风险**（见 §5）。
- **[CONFIRMED]** **Public Categories 当前不存在**：schema 中无公共分类表、无公共分类关联、无 Discover 分类投影；旧 Catalog taxonomy 已由 migration 0041 删除。
- **[CONFIRMED]** 当前支持语言为 `['zh-CN', 'en-US']`，默认 `zh-CN`。见 [locales.ts](../../../packages/i18n/src/locales.ts)。
- **[CONFIRMED]** 存在可复用的 **Provider Resolver / BYOK** 配置解析链路（`User → Instance → Unavailable`），本合同的 AI 能力 **MUST** 复用它（见 §6）。
- **[CONFIRMED]** **个人标签的实现可以独立推进**，不依赖 Public Categories 建成；公共分类未批准不阻塞个人 AI 整理。

---

## 3. 身份、所有权与来源边界

- **[CONFIRMED]** 本合同涉及**三个互不混写的数据域**：
  1. **Personal Tag（个人标签）：** 单个用户私有、自由命名、可更精细；当前实现为 User Tags。
  2. **Public Category（公共分类）：** 全实例共享的公共 Discover 分类；当前不存在，仅在本合同批准后引入。
  3. **Source Metadata（来源元数据）：** 来源原始字段（如 Subjects / Bookshelves），原样保存用于追溯与映射，**MUST NOT** 冒充产品分类。
- **[CONFIRMED]** 此外有一个**有界 AI 决策结果，它不是数据域、不是领域实体**：一次针对作品、用户与模型版本的有限推断，**MUST NOT** 成为可浏览的概念、标签或分类表。
- **[CONFIRMED]** Personal Tag 与 Public Category **MUST NOT** 共享身份、表、权限或生命周期；同名不等于同身份。
- **[CONFIRMED]** **共享 AI 行为不等于共享 schema / service / lifecycle。** 两个领域可以复用底层 AI 调用、结构化输出与本地化能力，但 **MUST NOT** 因此合并数据模型或业务服务。
- **[CONFIRMED]** 标签**创建来源**与**每本书关联来源**是两件事，**MUST** 分别记录（见 §8）。
- **[OPEN]** Public Category 关联的目录身份（`SourceRecord` vs `ReadingWork`）**不在本合同内解决**；本合同不假设、不迁移、不合并两者身份，任何实现都 **MUST NOT** 擅自选定。

### 3.1 共享 AI 决策流程（两个必须分开的决策）

Personal Tags 与 Public Categories **MUST** 遵循同一决策流程（共享行为，不共享 schema/service/lifecycle）。该流程 **MUST** 把**两个决策严格分开**，二者 **MUST NOT** 互相替代：

**决策 A —— 概念等价（Concept Equivalence）：判定“两个术语是否同一概念身份”**

- 只有当两个术语**语义等价（含已确认的跨语言同义）**时，才 **MAY** 复用同一概念身份。
- **相关、相似、近义、上位、下位**等关系 **MUST NOT** 作为身份复用的依据；**MUST NOT** 仅凭字符串相等判定身份。
- **MUST** 参与判定的信息包括：**别名、本地化名称、含义/范围说明**；作用域 **MUST** 限于当前用户自己的标签或当前公共词表，**MUST NOT** 跨用户或跨域查询。

**决策 B —— 书籍适用性（Book Applicability）：判定“这本书应关联哪些既有概念”**

- 在身份判定之外，**另行**依据证据决定**哪些既有概念真正描述/组织这本书**。
- 书籍的**具体主题** **MUST NOT** 被要求与**宽泛分类名**在字面上语义等价。例如证据支持时，「人工智能发展史」**MAY** 适用「科学」「技术」和/或「历史」等更宽概念；**MUST NOT** 因主题更窄而拒绝适用，也 **MUST NOT** 要求精确一一对应。
- **MUST** 先评估**已有概念的适用性及其组合**；**只要覆盖足够，即使主题更窄也 MUST NOT 新建**。
- 仅当（覆盖不足）**且**（拟议概念具备**持久的公共导航价值**或**个人可复用价值**）时，才 **MAY** 考虑 `CREATE`。
- `CREATE` **MUST NOT** 因为“存在一个更窄、更具体的主题”而自动发生。

**流程步骤：**

1. **证据基础：** 只依据标题、作者、简介/描述、来源元数据（如 Subjects/Bookshelves）与所需正文摘录推理；摘录 **MUST** 有界；**MUST NOT** 编造事实，也不得凭标题臆测身份、受众或价值判断。
2. **作用域限定：** 只查询**当前作用域**内的概念——个人标签仅该用户自己的标签，公共分类仅当前公共词表；**MUST NOT** 跨用户或跨域查询。
3. **候选检索：** 取回相关的**别名、本地化名称与含义/范围说明**；**MUST NOT** 仅凭字符串相等判定身份。
4. **语义区分（决策 A）：** 必须区分**等价 / 跨语言同义 / 近义 / 上位-下位 / 相关但不等价 / 无关**；**MUST NOT** 把后四类当作等价复用。
5. **适用性与组合优先（决策 B）：** 先评估**已有概念的适用性及其组合**是否已覆盖，再考虑新建。
6. **结果取值（恰为四种）：** `REUSE`（复用现有，含已确认的跨语言同义）、`CREATE`（仅当**覆盖不足**且新概念**可复用/有持久价值**，阈值**严格高于** `REUSE`；**不因存在更窄主题而自动创建**）、`NO_MATCH`（弃权：无匹配或证据不足）、`NEEDS_REVIEW`（语义冲突/歧义）。公共侧 **MUST** 把弃权（`NO_MATCH`）**呈现**为 `NO_CATEGORY`；这只是展示，不是第五种取值。

---

## 4. Public Categories（公共分类）合同

- **[CONFIRMED]** Public Categories **MUST** 是**扁平、宽泛、稳定、易懂、可复用**的分类：**MUST NOT** 引入父子树或层级导航，**MUST NOT** 做成单作品实体或临时热词。
- **[CONFIRMED]** **MUST NOT** 强制要求 Genre/Form 与 Subject 两个维度；维度拆分不是本合同的前置条件。公共分类是一组可直接展示的简明概念。
- **[CONFIRMED]** 一本作品 **MUST** 关联 **0–3 个**公共分类，且 **MUST NOT** 为填满数量而凑数（不设配额）。
- **[CONFIRMED]** **身份复用（决策 A）**仅在拟议术语与已有分类代表同一概念时发生；**MUST NOT** 把相关、上位、下位概念当作等价身份。
- **[CONFIRMED]** **书籍关联（决策 B）**依据内容证据判断分类是否适用，不要求分类名与作品的具体主题等价；**MUST** 先检查已有分类及其组合是否足以组织作品，足够时 **MUST NOT** 新建。只有覆盖不足且新分类可跨作品复用、具备持久导航价值，且不是单作品实体/情节拼接/临时热词/过窄细节时，才 **MAY** 创建。
- **[CONFIRMED]** **AI 自动创建公共分类允许存在，但 MUST 严格且低频**：证据不足时 **MUST** 弃权（`NO_MATCH`，公共侧呈现为 `NO_CATEGORY`）或转 `NEEDS_REVIEW`，**MUST NOT** 为单条记录制造新概念。
- **[CONFIRMED]** 每个公共分类 **MUST** 有稳定 ID；显示名可变，ID 不变（见 §7）。
- **[CONFIRMED]** Public Categories **MUST** 支持**空集合冷启动**：无需预先存在任何词表或 seed；AI **MAY** 在 §3.1 的严格质量门槛下创建公共分类。冷启动**不是**运行时的前置阻塞。
- **[RECOMMENDED]** 可选地、且**仅在获得明确授权后**，从少量成熟概念开始播种，或由固定来源映射优先覆盖明显项，再增量调用 AI；**MUST NOT** 对全量目录重跑模型。该播种**不是运行时前置条件**，本合同不假设、也不预设具体 seed 词表。
- **[OPEN]** 是否/何时执行可选播种、以及其具体词表、命名与冻结时间未定（属未来公共分类的 OPEN 项）。
- **[OPEN]** 公共分类创建失败/并发的原子性策略与回滚语义尚未批准。

---

## 5. Personal Tags（个人标签）合同

- **[CONFIRMED]** Personal Tags **MUST** 保持**私有、用户所有**：仅当前用户可见、可读写，**MUST NOT** 参与公共 Discover 或跨用户共享。
- **[CONFIRMED]** 个人标签 **MAY** 比公共分类更精细、更个性化；个人标签不是公共分类的子集。
- **[CONFIRMED]** 手动标签名称 **MUST** 保持自由形式（free-form），仅受**安全性**约束。
- **[RECOMMENDED]** 安全约束建议包括：拒绝危险控制字符与 bidi override；名称按文本渲染而非 HTML；长度按可显示字符（grapheme）而非 UTF-16 元数量限制；不做“只保留 ASCII”过滤；比较键使用 NFC + 明确定义的 Unicode、locale-independent case-fold，保留有意义标点。
- **[OPEN]** 名称长度上限、是否允许 emoji/组合标记、控制字符白名单等最终安全策略未批准。
- **[CONFIRMED]** 唯一性按用户隔离（`user_id`）；不同用户可有同名标签而互不影响。
- **[CONFIRMED]** 当前 `user_tag` 只有单一名称字段，**没有**多语言名称存储；个人标签的多语言命名是**已知限制**，不是现状能力。
- **[CONFIRMED]** 当前 `normalizeTagName` 为 ASCII-only，会折叠含 ASCII 数字的 CJK 名称（`英语学习2` / `儿童文学2` → 同一 key）。这是**当前已存在的技术风险**（见 §2）。
- **[CONFIRMED]** 新实现 **MUST** 使用**安全、确定的 Unicode 规范化**（NFC、Unicode 空白折叠、locale-independent lowercase，配合前条安全约束）；**MUST NOT** 复制旧的 ASCII-only 行为；标点保留并参与名称唯一性。
- **[CONFIRMED]** 切换 `normalized_name` 算法时，允许一次性执行碰撞预检与规范化重算；遇到同一用户内碰撞 **MUST** 中止，且 **MUST NOT** 自动删除或合并标签。**MUST NOT** 保留长期旧算法兼容层，也 **MUST NOT** 把“旧数据迁移/预检”作为本功能的常设前置阻塞。
- **[CONFIRMED]** **当前不做任何数据库清库**。未来若需重置开发库，**MUST** 先确认目标与数据安全，并获得**明确授权**；任何 **Schema 迁移** **MUST** 另行单独授权。
- **[CONFIRMED]** 自动化测试与**代理（agent）数据库写入** **MUST** 只使用隔离的 `gloaming_test`；该测试隔离规则 **MUST NOT** 被解释为禁止未来**经明确授权**的开发迁移或正常业务校验/写入。

---

## 6. AI 自动整理（个人标签）合同

- **[CONFIRMED]** AI 自动整理 **默认关闭（default-off）**，**MUST** 仅在用户主动开启后才运行。
- **[CONFIRMED]** AI 自动整理 **MUST** 使用**现有 Provider Resolver / BYOK**；**MUST NOT** 为标签功能另造 provider resolver 或独立配置链路。
- **[CONFIRMED]** 调用 **MUST** 以已认证用户身份传入 `userId` 并重新校验模型访问；**既有 Provider Resolver / BYOK 行为原样复用、不修改**，本功能 **MUST NOT** 新建或覆盖任何 fallback 规则。Provider 不可用时 **MUST NOT** 丢失用户内容或阻塞阅读。
- **[CONFIRMED]** 复用优先：**MUST** 先在该用户自己的标签集合内做确定性规范化匹配，再以有限候选做模型判定；候选集中 **MUST NOT** 包含其他用户的标签。
- **[CONFIRMED]** 模型返回的标签 ID **MUST** 由服务端重新校验所有权；无效/越权 ID **MUST** 回退为“不关联”。
- **[CONFIRMED]** 新建个人标签 **MUST** 同时满足：用户现有概念及其组合都不适用、新概念对用户可复用；**MUST NOT** 为凑数创建。
- **[CONFIRMED]** AI 自动创建**允许存在，但 MUST 严格且低频**，并可在用户关闭自动整理后完全停止。
- **[CONFIRMED]** 用户手动编辑 **MUST** 优先：AI **MUST NOT** 覆写用户显式命名、显式编辑或显式关联。
- **[RECOMMENDED]** **首版建议：** 单本书 **AI 自动**关联的标签数量上限为 **3**；允许 **0** 个（无合适概念时不关联）、**MUST NOT** 为填满上限凑数。该 3 是**首版建议值**，尚未确认为产品硬上限。
- **[CONFIRMED]** 该上限**仅适用于 AI 自动关联**；**用户手动**关联的数量**不受此限**，且 **MUST NOT** 为此引入可配置的上限项。
- **[CONFIRMED]** 该 3 的历史依据来自**旧的公共作品（public-work）AI Metadata 流程**：**可访问的历史 `dev` 实现**在该流程的 prompt、输出 schema 与 cleanup 三处均限制为 3；历史 metadata 评审文本亦建议最多 3。该历史数字**不表示个人自动整理已被接受或已通过验收**，不构成个人 AI 自动整理的验收依据。
- **[CONFIRMED]** 语料中**旧 `main` 的确切源码未能直接访问**，因此**不宣称**已在 `main` 上验证该上限；上述仅描述可访问的 `dev` 实现与历史评审文本。
- **[CONFIRMED]** AI 不可用时 **MUST NOT** 阻塞解析或阅读，也 **MUST NOT** 使上传失败；界面仅以轻量状态说明“未自动整理”。
- **[CONFIRMED]** 任务 **MUST** 幂等：重试不重复建标签、不重复关联。
- **[OPEN]** 自动整理的默认开关位置、每本书的显式触发方式，以及关闭后已有 AI 关联的处理未定。
- **[OPEN]** 成本/预算上限、每次调用 token 上限与并发策略未测量、未批准。

---

## 7. 多语言（i18n）合同

- **[CONFIRMED]** 多语言 **MUST** 从第一天起支持，并跟随当前 `SUPPORTED_LOCALES`（`zh-CN`、`en-US`，默认 `zh-CN`）；**MUST NOT** 硬编码未来语言。
- **[CONFIRMED]** **User Tags 与 Public Categories 都 MUST 有稳定身份与本地化名称**；改显示名或补翻译 **MUST NOT** 改变稳定 ID。
- **[CONFIRMED]** 用户 **MAY** 在任意 `SUPPORTED_LOCALES` 语言创建名称；AI **SHOULD** 补齐其他 locale 的名称。
- **[CONFIRMED]** **两条 i18n 相关触发路径 MUST 分开：**
  - **(A) 上传后自动整理（auto organization on upload）：** 默认关闭，**仅**在用户主动开启后运行。
  - **(B) 手动创建标签触发的翻译补全：** 用户**手动**创建标签时 **MAY** 调用 AI 翻译其他 locale；该调用**独立于**自动整理开关，**不受**自动整理是否开启的限制。
- **[CONFIRMED]** 路径 (A) 与 (B) **都 MUST** 复用**现有 Provider Resolver / BYOK**；**MUST NOT** 另造 provider 配置链路。
- **[CONFIRMED]** Provider 不可用时：**MUST** 保存原始标签、**MUST NOT** 阻塞创建或阅读；界面 **MUST** 提示该语言翻译未完成或提示配置 provider，**MUST NOT** 伪造翻译。
- **[CONFIRMED]** **人工对任意翻译的编辑 MUST 受到保护**，**MUST NOT** 被任何后续自动化（路径 A 或 B、重试或补全）覆盖。
- **[CONFIRMED]** 生成其他 locale 失败时 **MUST** 保留来源名称，并明确提示这些语言的翻译**未完成**；**MUST NOT** 伪造翻译或写入空值。
- **[CONFIRMED]** **MUST NOT** 为每种语言创建独立概念/标签 ID。（当前 `user_tag` 尚无多语言名称存储，见 §5；此为合同目标。）
- **[CONFIRMED]** 人工编辑的名称/翻译 **MUST** 被保留；自动任务 **MUST NOT** 覆盖人工值。
- **[CONFIRMED]** 翻译缺失时 **MUST** 回退到来源标签（源语言原文），**MUST NOT** 用空字符串或机器回译冒充。
- **[RECOMMENDED]** 回退顺序建议为：用户 locale → 源语言/canonical label → 另一个已有人工校对的 label。
- **[OPEN]** 每个名称条目是否记录来源/是否人工编辑（字段级 provenance）以及管理视图呈现方式未批准。
- **[OPEN]** 来源标签与用户所选 locale 冲突时的具体提示文案未定。

---

## 8. 关联来源与用户移除语义

- **[CONFIRMED]** **标签创建来源**（tag 如何产生，如 `manual | ai`）与**每本书关联来源**（此书为何关联该标签，如 `manual | ai`）**MUST** 分开记录。
- **[CONFIRMED]** 当前 `user_work_tag` **没有** provenance 字段；分开记录创建来源与关联来源是待实现的**前提**，而非现状。
- **[CONFIRMED]** 关联的唯一约束可保留；来源字段 **MUST NOT** 被用来推断或覆盖用户意图。
- **[CONFIRMED]** 用户在书页移除某 AI 关联时，**MUST** 仅删除该关联，**MUST NOT** 删除用户共享的标签本身，也 **MUST NOT** 影响其他书的关联。
- **[CONFIRMED]** **普通重试（ordinary retry）MUST NOT 恢复用户已移除的 AI 关联。**
- **[RECOMMENDED]** 用户显式“重新整理/重新分析”时可再次推荐；对先前被移除的项建议需用户再次确认——此项为 **RECOMMENDED，尚未确认**；用户目前仅确认“普通重试不得恢复被移除的关联”。
- **[RECOMMENDED]** 为抑制被移除关联的复活，建议记录最小的 suppression/decision 状态；**MUST NOT** 仅靠“已删除的关联行”推断排除状态。
- **[OPEN]** suppression/decision 的**确切持久化策略**（存哪、保留多久、清理与隐私边界）**尚未决定**；这也是首版是否引入该记录的未决点。
- **[OPEN]** 模型/规则/策略版本的保留粒度未定（建议只留精简元数据，不留正文或 chain-of-thought）。

---

## 9. 公共分类质量检查与治理

- **[CONFIRMED]** **管理员触发的公共分类质量检查是只读建议**（read-only suggestions）：只分析并生成可解释建议，**MUST NOT** 直接改动分类。
- **[CONFIRMED]** **破坏性变更 MUST 经管理员确认**：改名、合并、停用/退役、批量重关联、改变范围边界或来源映射规则等，**MUST NOT** 由单次 AI 分类事务自动执行。
- **[CONFIRMED]** AI 分类审核工具 **MUST** 是只读的：**MUST NOT** 提供 SQL、任意 CRUD、删除分类、直接写库或改名的能力。
- **[CONFIRMED]** 每条建议 **SHOULD** 可追溯：至少包含建议类型、涉及分类 ID、简短理由、证据记录 ID、建议动作与置信说明。
- **[CONFIRMED]** 被拒绝或被暂缓的建议 **MUST NOT** 改变任何分类或关联。
- **[OPEN]** 运营审查 UI 的**具体细节未定**：入口位置、分页/筛选、"接受/驳回/稍后"交互、历史保留与权限，均待批准。
- **[OPEN]** 审查运行记录是否需要永久保存（是否落 schema）未确认；**MUST NOT** 仅以临时聊天文本作为生产运营记录。

---

## 10. 16 项验收矩阵

决策取值（共享）：`REUSE` / `CREATE` / `NO_MATCH` / `NEEDS_REVIEW`；公共无分类渲染为 `NO_CATEGORY`；`SKIP` 表示自动整理未开启或不适用。列含义：前置条件、决策、允许创建、禁止行为、可测试验收。

| #   | 前置条件                                                | 决策                                                                               | 允许创建                                                       | 禁止行为                                                                      | 可测试验收                                                                                          |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 01  | 已有公共分类「科幻小说」，新概念「科幻」                | `REUSE`（同义等价）                                                                | 无                                                             | 新建重复的「科幻」；把同一概念当新 ID                                         | 「科幻」解析到「科幻小说」稳定 ID；无新分类行                                                       |
| 02  | 作品同时符合科幻 + 冒险 + 悬疑                          | `REUSE` 多个既有独立概念                                                           | 无                                                             | 创建「科幻冒险悬疑」组合概念                                                  | 关联 3 个既有独立 ID；无组合分类                                                                    |
| 03  | 仅有宽泛「文学」，作品明显是科幻                        | 先评估「文学」等既有概念的适用性/覆盖：覆盖足够则 `REUSE`，否则再评估是否 `CREATE` | 仅当覆盖不足且「科幻小说」具备持久公共导航价值                 | 机械地 `CREATE`「科幻小说」；把「文学」当「科幻」等价复用；给过宽类造虚假别名 | 先输出「文学」适用性/覆盖判定；仅当覆盖不足且新概念确有公共导航价值时才新建，否则留空或 `NO_MATCH`  |
| 04  | 证据只支持一个分类                                      | `REUSE`/`CREATE` ×1                                                                | ≤1 个公共分类                                                  | 为凑满数量添加弱相关分类                                                      | 恰好 1 条关联；无填充项                                                                             |
| 05  | 证据不足/不确定                                         | `NO_MATCH`                                                                         | 无                                                             | 猜测或强加任何分类                                                            | 0 条关联；记录仍可浏览                                                                              |
| 06  | 已有「传记」，来源给出「Biography」                     | `REUSE`（跨语言同身份）                                                            | 无                                                             | 按语言新建重复 ID                                                             | 同一稳定 ID；按 locale 显示；无新分类                                                               |
| 07  | 用户已有个人标签「前端开发」「软件工程」，整理 React 书 | 按书内容证据决定 `REUSE` 哪些；证据不足则关联更少或 `NO_MATCH`                     | 无（仅当确有必要且可复用时才新建）                             | 为凑齐而强行复用两个标签；新建不必要标签；读取/写入他人标签                   | 只关联书内容证据支持的既有标签；无冗余新建；仅该用户关联                                            |
| 08  | 用户手动创建标签「React SPA」                           | 允许手动（自由命名，仅安全约束）                                                   | Personal Tag（手动）                                           | 因“不是标准分类”拒绝；把名称当 HTML 渲染                                      | 标签创建成功并按文本显示；仅安全校验失败时拒绝                                                      |
| 09  | AI 提议过细/单作品/句子式标签                           | `NO_MATCH`                                                                         | 无                                                             | 写入该过细标签                                                                | 提议被拒且不落库                                                                                    |
| 10  | 用户已移除某条 AI 关联，随后普通重试                    | `SKIP`（仅抑制被移除的 `(user, work, tag)` 关联）                                  | 无（同一本书的其他 AI 整理仍可进行）                           | 普通重试恢复被移除关联；删除共享标签；抑制整本书或整标签                      | 该关联仍不存在；同一本书其他合法 AI 整理不受抑制；标签与其他书关联不受影响                          |
| 11  | 用户创建中文手动标签时 Provider 不可用                  | 手动写入持久化，翻译延后                                                           | Personal Tag（手动）                                           | 因 Provider 不可用阻塞创建；伪造翻译                                          | 中文标签已保存并显示；其他 locale 标注“翻译未完成”；无模型调用                                      |
| 12  | 英文标签已被人工编辑，随后自动补 locale                 | 保留人工值，仅补缺失 locale                                                        | 仅缺失 locale 名称                                             | 覆盖人工编辑的英文名                                                          | 人工英文名不变；仅新增缺失 locale                                                                   |
| 13  | 两个用户各自创建同名「科幻」                            | 各自独立                                                                           | 每用户各自 Personal Tag                                        | 合并 ID；跨用户可见/共享                                                      | 标签 ID 不同；读写隔离；互不可见                                                                    |
| 14  | Gutenberg 与另一来源映射到同一概念                      | `REUSE`（同一稳定 ID）                                                             | 无                                                             | 每来源建独立 ID；改写来源 raw metadata                                        | 两来源共用同一分类 ID；`sourceMeta` 原样保留                                                        |
| 15  | AI 审核发现疑似重复公共分类                             | `NEEDS_REVIEW`（仅建议）                                                           | 无                                                             | 自动合并/删除/改名；模型直接写库                                              | 生成带证据建议；管理确认前分类不变                                                                  |
| 16  | 同一记录首次分类，随后重复导入或并发分类任务            | 首跑 `MAY CREATE`；并发/重试运行幂等：复用已提交实体                               | 首跑每个新候选各自独立通过质量门槛（不设“仅一个概念”的硬上限） | 产生重复概念或重复关联                                                        | 首次运行每个新候选各自独立通过质量门槛；并发/重试不得重复建实体或关联；幂等不等于每次都返回 `REUSE` |

---

## 11. 与研究文档的差异记录

以下为**历史提案**，已被本评审草案取代（superseded）。本草案未批准，历史报告 **MUST NOT 被删除或改写**；它们仍是可追溯的调研证据。

- **[CONFIRMED]** **层级/维度差异：** [public-classification-design-study.md](public-classification-design-study.md) 曾推荐两个并列维度（Genre/Form + Subject）并讨论未来二级层级；本合同改为**扁平、简单**的公共分类，**不强制**维度拆分，**不引入**树。
- **[CONFIRMED]** **AI 个人标签创建差异：** [tag-taxonomy-audit.md](tag-taxonomy-audit.md) 曾建议“永不自动创建 User Tag / 需逐一确认”；本合同允许 **AI 自动创建，但严格、低频，且仅在用户开启自动整理后**。
- **[CONFIRMED]** **默认值差异：** [metadata-classification-design-review.md](metadata-classification-design-review.md) 对自动整理默认开关曾倾向默认开启；本合同明确 **默认关闭**。
- **[CONFIRMED]** **Discover 身份差异：** [public-classification-design-study.md](public-classification-design-study.md) 曾推荐以 `SourceRecord` 作为公共目录身份；本合同**不解决** `SourceRecord` vs `ReadingWork` 身份问题（见 §3）。
- **[CONFIRMED]** 本合同同样取代旧报告里“需要先建成 Discover 分类才能做个人整理”的隐含顺序：**个人标签可独立实现**。

---

## 12. 实现边界与依赖

- **[CONFIRMED]** 个人标签 AI 自动整理 **MAY** 独立实现，**MUST NOT** 依赖 Public Categories 的存在。
- **[CONFIRMED]** 现有 metadata enrichment 仅作用于 **Catalog Work**；Personal EPUB 自动打标 **MUST** 走**独立的用户作用域路径**，以已认证 `userId` 复用现有 Resolver / BYOK，**MUST NOT** 复用或改写 Catalog-only enrich 流程及其 ownerless 假设。
- **[CONFIRMED]** 由于该用户作用域路径不存在，个人 AI 整理是**新增能力**，**MUST NOT** 被视为已实现。
- **[CONFIRMED]** 跨层顺序：若未来引入公共分类，**MUST** 先由 `packages/db` 拥有 schema/迁移，再到 backend 服务与测试，再到 web；共享公共契约变更 **MUST** 先改 `packages/shared`，再改 backend 与 web。
- **[CONFIRMED]** **MUST NOT** 新增第二套个人标签模型，**MUST NOT** 引入公共 Taxonomy CMS、AI 可自由扩张的公共词表、跨用户共享分类或向量库。
- **[CONFIRMED]** 复用既有基础设施：Provider Resolver / BYOK、`invokeAi` 结构化输出、locale 本地化能力；**MUST NOT** 为分类另造调用栈。
- **[CONFIRMED]** 自动化测试与代理数据库写入 **MUST** 只针对 `gloaming_test`；**MUST** 限定清理为测试自建数据。该测试隔离规则 **MUST NOT** 被解释为禁止未来**经明确授权**的开发迁移或正常业务校验/写入。
- **[RECOMMENDED]** **首版最小实现阶段（建议）：** 仅做**个人标签（Personal Tags）**的**可选加入（opt-in）自动整理器**，面向 **Personal EPUB**，与 **Public Categories 完全独立**。可能涉及的既有模块：`packages/db`（schema / 迁移）、backend 的**库标签（library tags）**与**已认证的 Personal EPUB 导入流程**、既有 **AI invoke / Provider Resolver**、必要时 `packages/shared` 的 DTO、web 的**设置 / 上传 / 状态**与 **i18n**。
- **[CONFIRMED]** 为支持**本地化名称**与 **provenance / suppression**，**schema 变更是很可能需要的**；但**本任务不授权**任何实现或 **Schema 迁移**。
- **[RECOMMENDED]** 实现顺序建议：先做个人标签正确性（Unicode 安全与幂等），再做上传后 AI 个人整理闭环，最后才在获批后引入公共分类。
- **[OPEN]** 具体 schema/迁移、共享 DTO、路由与前端改动范围 **未批准**，本文件不预设。

---

## 13. 开放决策与内部一致性清单

### 13.1 开放决策（OPEN）

**A. 个人标签首版（实现前的实际待决，个人需求/上限已决定）**

1. **suppression 持久化策略：** 如何、在哪、保留多久地记录“用户已移除的 AI 关联”，以让普通重试不回加（见 §8）。
2. **自动整理开关位置与关闭后已有关联的处理**（见 §6）。
3. **成本/预算与并发上限：** token、每批处理量与重试边界（尚无测量）。
4. **多语言字段级 provenance 的持久化细节**（是否记录每个名称来源，见 §7）。

> 个人标签的**需求与首版关联上限已决定**（首版 AI 自动 ≤3、允许 0、不凑数，手动不限；见 §6），因此**不再列为开放阻塞项**。

**B. 公共分类（未来工作，不阻塞个人标签首版）**

5. **`SourceRecord` vs `ReadingWork` 身份：** 明确不在本合同解决；任何实现不得擅自选定。
6. **可选播种授权：** 是否/何时在明确授权下播种少量成熟公共分类；**冷启动不依赖它**（见 §4）。
7. **公共审查 UI：** 只读建议的入口、交互（接受/驳回/稍后）、历史保留与权限细节。
8. **首发公共分类命名/维度呈现/冻结时间：** 是否区分维度（非强制）。
9. **公共分类创建失败/并发的原子性与回滚语义。**
10. **审查运行记录是否落库。**

### 13.2 内部一致性清单（Final Consistency Checklist）

- [x] 全文仅使用 CONFIRMED / RECOMMENDED / OPEN，且每处可归属。
- [x] Public Categories 表述为扁平、简单；无树、无强制 Genre/Form+Subject 维度。
- [x] 公共分类 0–3、不凑数、同范围复用、仅在不适用且可复用时创建。
- [x] AI 自动创建在两处均为“允许但严格低频”。
- [x] Personal Tags 私有、自有、可更精细；手动命名自由形式且仅受安全约束。
- [x] AI 自动整理默认关闭，仅用户开启后运行，且复用 Provider Resolver / BYOK。
- [x] §6 复用既有 Resolver/BYOK 行为不变，未新增或覆盖 fallback 规则；不可用时不得丢失内容或阻塞阅读。
- [x] 共享 AI 行为不隐含共享 schema / service / lifecycle。
- [x] §7 明确 User Tags 与 Public Categories 均有稳定身份与本地化名称；可在任意支持语言创建、AI 补其他 locale、失败保留来源名并提示翻译未完成。
- [x] 创建来源与关联来源分离；普通重试不恢复被移除的 AI 关联。
- [x] 显式“重新整理”的再次确认标为 RECOMMENDED/OPEN，未写成 CONFIRMED。
- [x] 公共分类质量检查为只读建议；破坏性变更需管理员确认。
- [x] 16 项验收矩阵为要求的具体场景，且含前置条件、决策、允许创建、禁止行为、可测试验收。
- [x] 记录研究文档差异，且未删除或改写旧报告。
- [x] 个人标签可独立实现；实现边界与 `gloaming_test` 约束已写明。
- [x] `SourceRecord` vs `ReadingWork` 身份保持 OPEN，未被隐式解决。
- [x] 个人标签首版上限标为 RECOMMENDED 建议（AI 自动 ≤3、允许 0、不凑数），手动关联不限且不引入可配置上限；该上限不再列为 OPEN 阻塞项。
- [x] 3 的历史依据归因到可访问的 `dev` 实现与历史评审，未宣称已验证旧 `main` 源码。
- [x] Unicode-safe 规范化记为当前风险与新实现要求；`normalized_name` 算法切换允许一次性碰撞预检与重算，但不得自动删除/合并或保留长期兼容层；清库与开发库 Schema 迁移均需另行授权；测试只用 `gloaming_test`。
- [x] 记录 `user_tag` 单一名称、`user_work_tag` 无 provenance、enrich 为 Catalog-only 且未传 `userId`。
- [x] §1 写明产品目标：准确组织与更易发现，不以标签/分类数量最大化为目标。
- [x] §3.1 含共享 AI 决策流程：证据边界、作用域限定、别名/本地化检索、六类语义区分、组合优先、REUSE/CREATE/NO_MATCH/NEEDS_REVIEW（CREATE 阈值严格高于 REUSE，公共无分类渲染 NO_CATEGORY）。
- [x] §3.1 明确区分决策 A（概念等价：仅语义等价/跨语言同义可复用身份）与决策 B（书籍适用性：按证据判断既有概念是否适用）；`CREATE` 不因存在更窄主题而自动发生。
- [x] §4 支持空集合冷启动；播种少量成熟概念为**可选且需明确授权**，非运行时前置条件。
- [x] 矩阵行 03/07/10/16 已修正：先评估适用性/覆盖；只用书内容证据支持的标签；仅抑制被移除的 `(user, work, tag)` 关联；首跑可 `CREATE`、并发/重试幂等且不等于每次 `REUSE`。
- [x] §7 区分 (A) 上传自动整理（默认关闭、仅用户开启）与 (B) 手动创建标签触发的 AI 翻译（独立于自动整理开关）；两者复用现有 Provider Resolver；不可用时不阻塞。
- [x] §12 提出首版最小实现阶段为面向 Personal EPUB 的个人标签 opt-in 自动整理，独立于 Public Categories，并列出可能涉及的既有模块。
- [x] 本轮仅修订本文件；未新增/修改其他文件、未触碰 Git、数据库或 AI。

---

**证据限制：** 本文为文档评审，未连接数据库、未运行迁移/同步/测试/构建，未调用任何模型，未修改业务代码或其他文件。
