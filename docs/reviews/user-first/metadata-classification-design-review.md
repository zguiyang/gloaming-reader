# Metadata & Classification Architecture Review

**阶段：** Investigation + proposal; no implementation.

**基线：** `dev-02` · `c1c153958a82a37767bb2b46c6f6b71f3861d7a3` (2026-10-11).

**范围：** 历史 AI 元数据/分类能力、当前 User Tags / SourceRecord 边界、产品方案。未读取或写入数据库，未运行迁移、同步、测试或 AI 服务；本文件是本轮唯一新增文件。

## 0. 更正先前审查

此前的 [`tag-taxonomy-audit.md`](tag-taxonomy-audit.md) 只检查了 `dev-02`，结论“当前没有 AI 自动生成标签能力”描述的是当前代码，并没有回答“旧版是否实现过”。本次补查了实际 `main`、`dev`、`dev-2026-08-20`、`dev-02` refs：用户指出的历史能力确实存在于较新的旧 `main` / `dev`，但这些能力当时面向旧全局 Catalog Taxonomy / 管理员 EPUB 入库；它们不等于当前个人 EPUB 自动整理已实现或真实模型验收通过。

## 1. 执行摘要

**推荐：** 保持四种身份互不混写：

1. **User Tags**：每位用户私有、自由命名的书库整理标签；是个人上传 AI 整理的首要目标。
2. **Public Categories**：仅供公共 Discover 使用的小型受控分类词表；稳定 ID、多语言显示名、人工治理。
3. **Source Metadata**：来源原始字段，包括原样保存的 Subjects / Bookshelves；用于追溯和映射，不冒充产品分类。
4. **AI Classification**：一次针对作品、用户和模型版本的推断结果；不应成为第五套可浏览的标签表，也不直接扩张公共词表。

AI 整理个人书库不应等待 Discover 分类建成。上传后，在用户启用 AI 且 provider 可用时，以短摘录、目录和用户自己的标签为上下文；先复用已有 User Tag，再在质量门槛通过时创建少量新标签。AI 只影响该用户与该作品的关联。用户编辑优先，Provider 不可用时书籍照常解析和阅读。

公共 Discover 推荐方案 C：使用一小组 Gloaming 维护的宽泛 Category 入口，底层保留多对多主题和书源映射。个人 User Tag 不参与 Discover。Gutenberg 的 Subjects / Bookshelves 保留原始值并映射；不直接将原值当作跨书源、长期稳定的公共分类。

## 2. 调查边界与 refs

| Ref              | HEAD                                       | 历史状态                                                        |
| ---------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `main`           | `a024d1ee610aedeace1ce438f07ec1de6ad212a6` | 已有 `modules/metadata-enrich/`、taxonomy 和测试                |
| `dev-2026-08-20` | `da207cb04232bac72c6ee903b4316259e4734fc0` | 早期基线；没有后来 `modules/metadata-enrich` / taxonomy 实现    |
| `dev`            | `a177dc2040738d0f9a3a49e7f2b047d946513c1c` | 已拆为 `domains/metadata/enrich/`，具备 AI tags/category 全流程 |
| `dev-02`         | `c1c153958a82a37767bb2b46c6f6b71f3861d7a3` | 当前工作区；描述增强保留，公共 taxonomy 已退役                  |

历史实现起点：`main` commit `31b54e9c`（AI metadata backfill + field registry + on-demand tools）；taxonomy AI 流程进一步完善于 `d186ff64`，本地化名称于 `280954b3`。移除脉络：`90044914` 移除旧 Admin provenance；`8b1de80a` 移除 taxonomy 管理；`002cd223` 移除 Catalog Works 管理；`4fe79caf` 执行完整 taxonomy 移除和 enrich 缩减。

历史代码可在各 ref 中查阅：`main:apps/backend/src/modules/metadata-enrich/`，`dev:apps/backend/src/domains/metadata/enrich/`，旧测试 `dev:apps/backend/tests/functional/domains/metadata/metadata-enrich.spec.ts`。当前依据见 [Metadata Enrich](../../../apps/backend/src/domains/metadata/enrich/fields.ts)、[workflow](../../../apps/backend/src/domains/metadata/enrich/workflow-service.ts)、[User Tag schema](../../../packages/db/src/schema.ts#L199-L240)、[User Tag normalizer](../../../apps/backend/src/domains/library/tags/normalization.ts) 和 [Gutenberg RDF parser](../../../apps/backend/src/domains/discovery/gutenberg/rdf-parser.ts)。

### 能力清单（旧实现、测试状态、当前状态）

标记说明：`OLD_IMPLEMENTED` 表示静态源码存在；`OLD_TESTED` 表示自动化测试覆盖（不代表真实模型运行）；`CURRENT_IMPLEMENTED` / `CURRENT_PARTIAL` / `CURRENT_REMOVED` 表示当前 `dev-02` 代码；`UNKNOWN` 表示没有足够证据。除非另写明，旧 AI 功能测试通过 mock `invokeAi`，没有找到真实模型运行记录。

| #   | 能力             | 历史证据与覆盖                                                                                    | 当前状态                                                                                                 |
| --- | ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | EPUB 标题提取    | `main/dev` EPUB OPF parser → metadata-fill；解析/入库测试覆盖                                     | `CURRENT_IMPLEMENTED`：当前 parser 仍取 OPF title 并规范化，非 AI                                        |
| 2   | EPUB 作者提取    | EPUB OPF creators 解析、作者合并；metadata fill 测试覆盖                                          | `CURRENT_IMPLEMENTED`：个人 EPUB 解析仍提取；非 AI                                                       |
| 3   | EPUB 简介提取    | `dc:description` 提取、清洗与规则填充；测试覆盖                                                   | `CURRENT_IMPLEMENTED`：解析器简介是 extracted；另有独立 AI 描述增强                                      |
| 4   | 封面提取         | EPUB2/3 cover 元数据与资源选择、存储；解析测试覆盖                                                | `CURRENT_IMPLEMENTED`：cover 作为 ContentAsset 处理；非 AI                                               |
| 5   | 插图处理         | EPUB 资源解包、图片识别、清洗/持久化；ingest 测试覆盖                                             | `CURRENT_IMPLEMENTED`：当前 EPUB parser 仍处理章节插图；非 AI                                            |
| 6   | 章节与目录提取   | spine / nav / NCX 解析、章节排序与清洗；单元/功能测试覆盖                                         | `CURRENT_IMPLEMENTED`：ReadingPart 与章节导航继续存在；非 AI                                             |
| 7   | AI 简介增强      | `prompt.ts`、`registry.ts`、`workflow-service.ts`；mock AI 的功能测试覆盖                         | `CURRENT_PARTIAL`：仅 description，且 enrich service 仅接收 ownerless Catalog Work；Personal Work 会早退 |
| 8   | AI 标签生成      | Prompt 约束 1–3 个短语；registry 清理/上限；mock AI 测试含弱标签替换                              | `CURRENT_REMOVED`：字段注册表当前只有 `description`                                                      |
| 9   | AI 分类生成      | Prompt 指定单一 shelf/genre；category registry / taxonomy-sync 写入；mock AI 测试                 | `CURRENT_REMOVED`：公共 category schema/关联已删除                                                       |
| 10  | AI 查询已有标签  | `tools.ts:listExistingTagsTool` 按使用量排名、规范化搜索，最多 20 条；测试调用 tool 函数          | `CURRENT_REMOVED`：旧 tool 不存在，当前 invoke 不传分类工具                                              |
| 11  | AI 复用已有标签  | Tool 返回 ID；taxonomy-sync 校验 ID，名字 fallback 做 normalized reuse；functional test 覆盖      | `CURRENT_REMOVED`：现有 User Tags 只有用户 CRUD/关联，没有 AI 复用路径                                   |
| 12  | AI 创建新标签    | 返回 `id:null` 时按 normalized 名称 upsert，设 `origin='ai'`；functional test 覆盖                | `CURRENT_REMOVED`：没有公共 Tag 可创建，也没有个人 AI tag 创建逻辑                                       |
| 13  | AI 自动关联作品  | `reading_work_tag` / `reading_work_category` 写入 `provenance='ai'`；mock AI functional test 覆盖 | `CURRENT_REMOVED`：当前 User Tag 关联表只支持手动 API，未存关联来源                                      |
| 14  | AI 来源标记      | Tag/Category 行有 `origin`，作品关联有 provenance；API DTO 暴露 metadata provenance               | `CURRENT_PARTIAL`：仅 `descriptionProvenance` 保留；User Tag/关联均无来源字段                            |
| 15  | 人工修改优先     | 旧 enrich 只覆盖空/弱值，只删 extracted/ai 关系；Admin 手工写入标记 manual；有测试                | `CURRENT_PARTIAL`：AI 描述按旧值比较避免覆盖并保留 provenance；标签 AI 路径不存在                        |
| 16  | 重新解析覆盖规则 | 旧 rule fill 只填空元数据，保留 manual；清理旧 extracted 关联，重跑前 reset AI 输出；测试覆盖     | `CURRENT_PARTIAL`：EPUB parse 仍在，但 taxonomy reset/fill 已删；无 AI 标签重算策略                      |
| 17  | AI 不可用降级    | `MODEL_NOT_CONFIGURED` 特定错误完成步骤并记录 gap；mock 测试区分其他 503                          | `CURRENT_PARTIAL`：描述增强仍保留该降级；Personal Upload 当前不调用该 AI 流程                            |
| 18  | 失败与重试       | workflow claim/lease、bounded retry、token rotation、job ID 幂等；functional/unit tests 覆盖      | `CURRENT_PARTIAL`：Metadata 描述 job 的 claim/retry 仍在；自动链默认关闭；不等于用户上传自动打标         |
| 19  | 标签质量校验     | stopwords、空/重复/长度限制（40）、LCSH 候选清理、最多 3 条；unit/functional tests 覆盖           | `CURRENT_REMOVED`：AI 分类校验代码随 taxonomy 删除；当前 tag normalizer 不负责语义质量                   |
| 20  | 多语言标签处理   | 旧 taxonomy ref 要求所有支持 locale 的 localizedNames；合并/缺失回填单测                          | `CURRENT_REMOVED`（分类翻译）；User Tag 名称可自由输入，但当前唯一键仅 ASCII 过滤，混合中英文可能冲突    |

上述每项状态简记如下（`OLD_TESTED` 指自动化测试覆盖，不代表生产或真实模型验收）：

| #     | 状态                                                     |
| ----- | -------------------------------------------------------- |
| 1–6   | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_IMPLEMENTED` |
| 7     | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_PARTIAL`     |
| 8–13  | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_REMOVED`     |
| 14–18 | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_PARTIAL`     |
| 19    | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_REMOVED`     |
| 20    | `OLD_IMPLEMENTED` · `OLD_TESTED` · `CURRENT_PARTIAL`     |

### 历史测试与运行事实

- 旧 `metadata-enrich.spec.ts` 将 `invokeAi` mock 掉：证明编排、schema、持久化和错误分支在预设模型响应下工作，不证明真实模型质量、provider 端到端或自动入库运行。
- 旧流程是 Catalog/Admin EPUB 元数据增强；后来 gate 变为 `ownerUserId === null && visibility === 'catalog'`。当前 `content-parse` 对 `user_epub` 的自动链会走个人上传解析路径，不把作品送进当前 Catalog enrich service。历史“AI 自动打标已实现”与“个人 EPUB 自动打标现在可用”是两个不同陈述。
- `WORKFLOW_AUTO_CHAIN=false`（当前默认）意味着存在 job/service 不足以证明正常上传会自动触发它。
- `4fe79caf` / migration 0041 删除 `tag`、`category`、`source`、`reading_work_tag`、`reading_work_category`、`reading_work_source`，并移除 taxonomy sync/tools/localization、Admin taxonomy、读侧映射/筛选和对应测试。保留了独立的 `user_tag` / `user_work_tag` 与描述 provenance。
- 因此可借鉴的是字段质量校验、有限上下文、弱值检测、幂等任务与失败降级；不能把旧公共表、旧 Admin taxonomy UI 和关联语义原封不动复活为个人标签模型。

## 3. 当前数据边界

| 身份            | 当前事实                                                                                                                            | 本方案中的责任                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| User Tag        | `user_tag(user_id,name,normalized_name)`；`user_work_tag(user_id,work_id,tag_id)`，复合 FK 保证标签归属该用户；无 origin/provenance | 个人分类、每个用户完全私有；AI 只能操作当前用户授权范围          |
| ReadingWork     | 当前个人 EPUB 为 owner 私有 Work；Work 不拥有全局 taxonomy                                                                          | 内容身份和解析结果，不将 Personal 标签写回公共作品               |
| SourceRecord    | source-owned 外部书目记录，可带 `work_id` 指向 ReadingWork；`source_meta` 保存原始 `subjects` / `bookshelves`                       | 保留上游来源语义，便于公共映射和来源详情                         |
| Public Category | 当前 schema 中已无旧 `category` / `tag`；migration 0041 删除                                                                        | 仅在 Discover 有明确用户任务后引入，稳定、受控、与 User Tag 隔离 |
| AI result       | 当前仅 description enrichment；没有分类结果模型                                                                                     | 未来应作为有限、可追溯的推断/决策，不创建公共 Taxonomy           |

### Unicode 用户标签问题（当前已存在）

当前 [`normalizeTagName`](../../../apps/backend/src/domains/library/tags/normalization.ts) 使用 `toLowerCase().replace(/[^a-z0-9]+/g, '')`。含 ASCII 数字的 `英语学习2` 和 `儿童文学2` 都可能规范成 `2`；`C++` 与 `C#` 都会失去标点差别。虽然后端并未禁止 CJK，当前 canonical key 对混合脚本并不安全。

产品规则建议：名称本身 trim Unicode whitespace、折叠连续空白、允许中英文/数字/有意义标点；比较键采用 NFC + 有明确定义的 Unicode、locale-independent case-fold；不做“只留 ASCII”过滤。不随意 NFKC 折叠语义上不同的符号；拒绝危险控制/bidi override 字符而非删除全部 format 字符。唯一性仍按 user_id；不同用户可以各有自己的同名标签。

**迁移前提：** 修正已持久化 key 需要只读冲突预检、人工处理冲突并保留 tag IDs / links 的一次性数据方案；本轮无数据库检查，也不提出现在执行迁移。

## 4. 同类产品研究

以下“已确认”只指官方文档/公开 README 声明的用户可见行为；没有从截图推断后端存储。没有找到这些产品将 AI 自动生成标签、来源 provenance 和人工优先级同时实现的公开证据时，明确标为未确认。

| 产品              | 已确认 / 未确认                                                                                                                                                                                                                                                                                                                                                                 | 对 Gloaming 的启发                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TextStack         | `SOURCE_CONFIRMED`：公开 README 声明上传 EPUB/PDF/FB2 自动解析并进行 metadata enrichment，另有 Admin Book/Author/Genre CRUD。任务指定的 `LibraryPage.tsx`、`LibrarySidebar.tsx`、`LibraryToolbar.tsx`、`LibraryStatusTabs.tsx`、`BookDetailPage.tsx`、`UserBookDetailPage.tsx` 本轮未能从远端读取，故其细部行为及 tag 自动化、匹配/创建流程为 `UNVERIFIED`。仓库声明 AGPL-3.0。 | 仅参考用户路径与结构；不要复制其代码/模型。不能据 README 推断 AI 自动 tagging。                                                 |
| Readest           | `SOURCE_CONFIRMED`：支持 user-created Groups、Tags 作为过滤标签、metadata 面板可编辑 title/author/series，用户编辑覆盖 EPUB 值；搜索支持 title/author/tags/series，含 Grid/List 和 recently-read。未见文档确认 AI tag generation。                                                                                                                                              | “应用内个人标签”和 EPUB 元数据可以并存且职责清楚；大库需要搜索、列表视图。                                                      |
| Calibre           | `SOURCE_CONFIRMED`：Tag Browser 按 Tags/Authors/Series 等筛选；支持 User categories、层级/自定义列与 metadata 手动编辑/下载；当前版含显式 AI 功能入口，但官方说明中的 AI Generate 针对封面，不是已确认的自动标签系统。                                                                                                                                                          | 丰富管理适合 power user，不适合直接把完整桌面管理器复杂度带入 Gloaming。                                                        |
| Kavita            | `SOURCE_CONFIRMED`：EPUB `dc:subject` 映射为 Genres；collection 可以由 collection tag/EPUB metadata 派生，管理端可控制是否启用。Kavita+ 的外部 metadata matching 属于另一路径。未确认生成式 AI tags。                                                                                                                                                                           | source field 映射到产品维度可行，但其漫画/服务器模型不可直接等同于个人电子书标签。                                              |
| BookFusion        | `SOURCE_CONFIRMED`：用户创建 Virtual Bookshelves 并加入/移除书籍；官方介绍支持 custom tags；Smart Shelves 是用户规则驱动的动态 shelf。未确认 AI 自动 tag 生成。                                                                                                                                                                                                                 | 静态个人标签、手动书架与规则视图是不同组织工具；本轮不要新增 Collections/Smart Shelf。                                          |
| Standard Ebooks   | `SOURCE_CONFIRMED`：EPUB 同时含 LCSH subject 与 Standard Ebooks 的宽泛、受控 `schema:genre` 列表，后者类似小书店类别。                                                                                                                                                                                                                                                          | 多源映射时保留来源词表身份；来源可同时给粗分类与精细主题，不应硬塞进单一 User Tag。                                             |
| Project Gutenberg | `SOURCE_CONFIRMED`：subject headings 通常在发行后数周补充；Bookshelf 为人工策展但已过时且不再维护；Browsing 类别是自动生成。新条目初始书目字段可能有限。                                                                                                                                                                                                                        | Gutenberg Subjects 可作为有用输入，Bookshelves 不适合作为稳定 canonical Discover taxonomy；展示来源分类前应记录来源和置信程度。 |

产品来源：[TextStack repository](https://github.com/mrviduus/textstack)、[Readest Library](https://readest.com/docs/library)、[Calibre GUI / Tag Browser](https://manual.calibre-ebook.com/gui.html)、[Calibre metadata editing](https://manual.calibre-ebook.com/metadata.html)、[Calibre What's New](https://calibre-ebook.com/whats-new)、[Kavita EPUB metadata](https://wiki.kavitareader.com/guides/metadata/epubs/)、[BookFusion Virtual Bookshelves](https://support.bookfusion.com/hc/en-us/articles/360030583872-Create-Virtual-Bookshelves-To-Organize-Your-eBooks)、[BookFusion Smart Shelves](https://docs.bookfusion.com/docs/smart-queries-%26-smart-shelves/overview)、[Standard Ebooks metadata manual](https://standardebooks.org/manual/1.9.1/9-metadata)、[Project Gutenberg bibliographic record](https://www.gutenberg.org/help/bibliographic_record.html)。

## 5. 产品与架构决策

### 5.1 User Tags 与 AI 个人整理规则

**推荐产品体验：** 解析成功后提供“整理标签”流程；用户可在设置中关闭自动整理。默认是否开启需用户最终确认。若开启：仅当用户 AI 功能已启用且可解析到有效 Provider 时才运行；否则不阻塞解析/阅读、不请求模型，界面静默显示“未自动整理”或轻提示。当前 AI runtime 可按 `userId` 解析用户作用域的 provider setting，但 `metadata-enrich` 调用未传 `userId`，所以目前不能据此认定 BYOK 已接入该流程。个人标签任务若支持 BYOK，必须以已认证用户身份传入 `userId` 并重新校验模型访问；若产品决定只走实例 provider，则应明确告知并沿用实例配置。不要为标签功能另造 provider resolver。

**推荐受控生成规则（产品建议值，待验证）：**

1. 一本书最多自动关联 **3 个** User Tag；优先复用，只有没有合适标签时才创建；不为填满数量造标签。
2. 输入只包含标题/作者/语言、少量目录标题和有上限的正文摘录（与历史 2,500 字符/15 条目录上限作为起始参考）；不上传整本 EPUB，也不做全书向量索引。
3. 标签使用书籍主体语言为主，除非用户偏好标签语言；不要为每个标签自动复制多种语言名称。跨语言映射可以用于匹配，但保留用户已有显示名。
4. 只能产生短名词短语，要求能归纳体裁、形式、核心主题或重要背景；拒绝作者/出版社/偶发人物地点、单词热词、目录标题、过长目录话术、空/重复/同义近重复标签、纯情绪猜测和超低置信项。
5. 先向用户标签集做确定性 normalized exact match，再以有限候选做模型判定；候选集中不包含其他人的标签。模型给返回的用户标签 ID；服务端重新校验用户 ownership。无效 ID 回退为“不关联”，不得由传入 ID 越权关联。
6. 新建采用 user-scoped unique key + transaction conflict handling；同一任务重试不重复建 tag、不重复关联。自动加入标签不改标签名/其他作品。重跑只处理 AI-owned decisions，不覆盖用户明确编辑/关联。
7. 对“用户手动移除 AI 关联后，自动重试/重新分析是否可以再加回来”作显式规则：推荐同一 upload generation 不再自动添加被移除的 tag；显式“重新整理”允许重新推荐，但需用户确认之前移除的项。若要跨重试保存排除状态，需小型决策/排除记账，不能只靠已删除的关联行推断。这项持久化是否进入首版属于待批准设计。
8. 显示简短完成状态与可撤销结果；提供一次性“重新整理/撤销”入口，不在每个标签 chip 上堆 AI 徽标。AI 添加状态可在书籍详情的整理面板说明，用户修改/命名之后 AI 创建来源作为内部审计属性保留，不代表该标签当前名称由 AI 控制。

**标签来源和关系来源是两件事。** 建议 `user_tag.created_origin = manual | ai`（标签如何创建）和 `user_work_tag.assigned_origin = manual | ai`（此书为什么关联该标签）分别记录；现有关联唯一约束可以保留。AI 不负责改名现存标签；用户改名仅更新 name/key，始终压过 AI 后续输出。用户在书籍页面移除关系，只删该关系，不删共享个人标签。标签详情的 AI 来源标记默认不显示；低干扰的详情/菜单说明即可，无 tooltip 作为唯一解释。

### 5.2 至少两种数据模型方案

| 方案                            | 做法                                                                                                                                                                                   | 优点                                                                   | 代价 / 风险                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A. 最小直接写关系               | 复用 `user_tag`/`user_work_tag`，仅增加 `origin` / `assigned_origin`，由 AI 创建/关联                                                                                                  | 小、直接符合用户要“自动整理”；没有第二套 tag 模型                      | 难区分模型重跑与用户删除的意图；来源字段难表达撤销/排除、提示版本和每次 run            |
| B. 小型个人分类决策记录（推荐） | User Tags 仍是唯一可见标签；补 `created_origin`、关联 `assigned_origin`；仅在需要保留撤销/重试/重新分析语义时，增加按 `(user, work, generation)` 幂等的 AI-tagging run / decision 记录 | 结果可解释、可重试、用户删除不会被后台悄悄加回；tag 仍是用户私有且唯一 | 多一张小的 workflow/decision 表、清理策略和管理员可观察性；需要明确保留期限与重分析 UX |

建议分阶段：首个 MVP 先决定自动整理是否默认开启及“删除后的重分析”语义；若支持自动重试与显式重跑共存，则选 B 的最小版本，否则 A 可作为试点，但不得宣称具备删除抑制/重跑审计。模型输出建议最多保留精简决定元数据与模型/规则版本，不保留大段正文或 chain-of-thought。

### 5.3 Discover：Tags、Categories 或混合

| 方案                                                | 理解成本 / 准确度                                                    | 多源维护 / 搜索                                                                                    | 结论                                       |
| --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A. Discover 使用 User Tags                          | 表面简单，但个人私有词汇跨用户不可比；用户上传标签会污染公共内容语义 | 权限与排序复杂，跨来源不一致                                                                       | 不推荐                                     |
| B. Discover 全部使用公共 Categories                 | 入口清楚，但词表过粗/过严都造成漏分或误分类                          | 需要维护名称、同义词、多语言和来源映射                                                             | 可作为前台主入口，不能当全部元数据         |
| C. 少量公共 Category + 多个标准化主题 facet（推荐） | 首屏只暴露一组读者能懂的宽泛入口；需要深入时再用主题/来源条件        | 稳定 ID + 每个 SourceRecord 多个 subject mapping；允许不同来源指向同一公共 term；保留 raw metadata | 符合 Discover 易用、接入多来源和追溯的平衡 |

推荐启动时最多约 6–10 个宽泛入口（如 Fiction、Mystery、Romance、Fantasy & Science Fiction、Poetry & Drama、History & Society、Philosophy & Religion、Children’s），**这只是待产品确认的候选，不是已批准词表**。用户界面显示名称按 locale 本地化，存储稳定 category ID。一本书可有多个 broad category 或 topic，搜索可同时匹配标题/作者/来源原始 subject。避免过早增加大树形层级。

公共词表首期由代码/受版本控制的治理清单维护，新增/重命名有 reviewer 与 mapping 更新，不需立即造 Admin 分类 CMS。只有在非开发运营者确实需要频繁维护后再评估轻量后台。AI 可以为一本书提出映射候选，不得直接新增/重命名公共 term；由规则、编辑或受控审查发布。旧的 admin taxonomy CMS、cleanup 全局词表和 recommendation 权重不建议恢复。

### 5.4 来源数据和多书源一致性

当前 Gutenberg parser 将 `dcterms:subject` / `pgterms:bookshelf` 存进 SourceRecord 的 raw `sourceMeta`。这适合 provenance 和未来映射；现有 Web Discover 仍有 ReadingWork Catalog API 与 SourceRecord API 的集成边界，不能把原始字段误称为现有 Discover 分类。

建议阶段 1–2 不丢失或改写 `source_meta`。接入多书源后按 source scope 做只读标准化映射：

```text
SourceRecord.sourceMeta (raw, immutable snapshot)
  → source-specific mapping rule (source key + normalized raw term)
  → PublicCategory ID(s) (reviewed, versioned)
  → Discover facet/read model
```

一个 raw subject 可映射到 0..N 公共分类；不同来源不同词可以映射至同一 category；未知值保留原文、暂不冒出公共 facet；更新 mapping 不改变原记录。Standard Ebooks 若作为第二来源，可利用其广泛的 SE genre 与精细 LCSH subject 分别输入粗类和主题。Gutenberg 的 Bookshelves 不应直接映射为长期标准 term。

## 6. 16 个用户场景

| #                              | 用户可见行为                                                           | 写入/边界                                                  | 异常与维护影响                                                   |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| 1. 首次上传、无标签            | 书照常可读；AI 若启用，完成后可看到最多 3 个标签                       | 为该用户建 User Tags 和仅个人关系；不写 Public Category    | Provider 关闭/失败则空标签，无解析失败；成本封顶                 |
| 2. 已有三标签且命中            | 重用标签，不新增重复标签                                               | 必须用 authenticated user 的 tag ID；不改既有标签名        | 低置信不关联；同 ID/规范名由 DB 唯一性兜底                       |
| 3. 无已有标签合适              | AI 添加有语义的新个人标签                                              | 只在质量门通过时创建；写 creator=AI、relation=AI           | 新标签膨胀用数量上限、近义候选与用户删除来抑制                   |
| 4. 一书适合两标签              | 同一本书可有 1–3 个并列标签                                            | 每个用户关系独立                                           | 不强迫选唯一分类；不要自动创建父子树                             |
| 5. 低质量输出                  | 不展示该标签；其他高质量候选仍可保留                                   | 不写入被拒绝候选                                           | 结构校验 + 语义规则；全被拒绝时标记完成但无标签                  |
| 6. 用户重命名 AI tag           | 用户看到自己的新名称，其他关联书同步显示新名                           | 更新该用户标签及规范名；来源仍记创建于 AI                  | 后续 AI 不得覆写；若规范 key 冲突需提示选已有标签/另取名         |
| 7. 用户移除 AI 关联            | 当前书不再有该标签，其他书的标签不受影响                               | 删除关系并保留用户标签本身；记录 suppression 可防重试回加  | 推荐只有显式重跑可再次建议；首版数据语义需决策                   |
| 8. AI 任务失败后重试           | 阅读不被阻塞，后台可显示未完成/失败轻提示                              | 相同 generation 幂等；事务、唯一键防双写                   | attempt 有界；Provider 不可用仅标注 skip，timeout/坏输出是真失败 |
| 9. 用户关闭 Provider           | 书正常解析，显示无 AI 标签                                             | 不产生模型调用或关联                                       | 绝不因 AI 配置失败将 EPUB 导入标失败                             |
| 10. 不同用户上传同一本书       | 两个人各有各自标签，不互见                                             | Work 与 User Tag scope 各自 owner；不共享 AI 个人结果      | 不因为内容 hash 相同就跨账户推断或泄露用户标签                   |
| 11. Gutenberg 有多个 Subjects  | Discover 展示已审核 broad category；详情可见来源原始主题（若产品需要） | SourceRecord raw values 留存；经 mapping 只写 public facet | 多主题允许多映射；不把 Bookshelf 当权威公共分类                  |
| 12. 加入 Standard Ebooks       | 用户可通过同一 Discover broad categories 过滤                          | 新 source mapping 独立于 Gutenberg                         | 没映射就保留 raw subject，避免来源接入被词表阻塞                 |
| 13. 不同来源分类名称不同       | 用户按同一个 Gloaming Category 找到相似作品                            | Source-scoped rules → stable category IDs                  | mapping 有版本/审阅；同义词不能靠显示名相等假定                  |
| 14. 公共 category 改名         | 用户仍通过旧书签/筛选 ID 找到作品，显示新名称                          | 更新 locale label，不重写 source raw；mapping 指向稳定 ID  | 删除 term 先评估映射，退役而非级联失去分类                       |
| 15. User Tag 与公共类同名      | 两处可同名，但界面分区和用途不同                                       | 完全不同 ID/表/权限                                        | 无跨域去重；避免语言文案把两种都称为“分类”导致混淆               |
| 16. 中文、英文、数字、标点 tag | 用户原样查看和搜索；只对规范化后的等价字符串提示重复                   | NFC/Unicode 比较键按用户唯一                               | 修复 legacy key 前先评估冲突；不静默合并两个标签 ID              |

## 7. 数据模型影响：必须 / 可选 / 暂不需要

| 状态                           | 建议                                                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前可复用                     | 保留唯一 User Tag 领域 `user_tag` / `user_work_tag`，`user_id` 作用域和同一用户 Work 权限；当前标签/书籍 CRUD 与 Library projection 可继续复用。                                                                                                    |
| 个人 AI 首期必需（实现前批准） | 在现有两表分别存 tag 创建来源与关系关联来源；AI 命令只能验证登录用户自己的 Work 与标签；确定 AI 开关/provider 解析、限额、幂等、删除与重跑语义；修正 Unicode 唯一键及预检迁移；有模型运行结果、attempt 与错误状态的最小操作性记录（决定方案 A/B）。 |
| 公共 Discover 真正需要时       | 稳定的 `public_category` 与本地化名称；SourceRecord/source-scoped raw term → category 多对多映射。SourceRecord 和 ReadingWork 身份不合并；分类只进入公共 read model。                                                                               |
| 未来可选                       | 显式 AI run/decision 表（如选择 B）、review queue/统计、可配置置信度阈值、权威 URI/外部 crosswalk、批量用户同义词整理。                                                                                                                             |
| 暂不需要                       | 第二套 User Tags、公共 Taxonomy Admin CMS、AI 可自由扩充公共词表、自动跨用户共享分类、AI tag 专属页面、整书 embedding、Collections/Smart Shelves、旧 Catalog tag compatibility view、双读双写。                                                     |

如果现有 User Tag 名称 key 修复涉及存量冲突，先只读列出冲突组，再做一次性保留 IDs/关系的迁移设计；不要在服务层临时双 key 查询或静默合并。公共 Category 如果从代码管理的枚举迁到表，同样一次性填充稳定 ID + locale labels + SourceRecord mappings，不保留旧全局 taxonomy 兼容层。

## 8. 旧能力的恢复建议

**建议恢复逻辑思路，而非旧实现：**

- 复用小上下文、按缺口执行、结构化输出、明确数量上限、语义质量 gate、已有项先匹配、事务幂等、明确 unavailable vs failure、人工值优先、读取与用户权限重验。
- 为个人用户重新设计调用身份和写入范围，不能把旧 Admin global `tag` API 的 `existingId` 直接传到当前用户表。
- 对用户每次上传独立创建/关联标签，不把 AI 结果提升为 Discover Category，也不将相同书跨用户的 AI 结果共享。
- 如保留 `AI` 来源，分别标记“标签创建来源”和“此书关联来源”；显示层保持克制。

**不建议恢复：** 旧 `tag/category/source` 全局模型、管理员 taxonomy CRUD、旧 Catalog 推荐算法依赖 tag 权重、LCSH 原始长术语直显成用户 tag、自动填充所有支持语言的双语 tag 名称、每次重新解析删除所有非 manual 关系再重建、AI upsert 改写现有全局 term 名称、旧 Admin EPUB 入库入口、把 `ReadingWork` 的个人标签投影到公共 Discover。

## 9. 分阶段实施计划（本轮不启动）

| 阶段                              | 目标与范围                                                                                                                 | 真实用户验收                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0. 产品/数据决定                  | 确认自动整理默认值、provider/成本权限、AI 关系删除/重跑、标签来源 UI、Discover 首期类目边界；只定契约                      | 产品决策可转成验收用例；不改数据                                                                                                     |
| 1. User Tag 基础正确性            | 修正 Unicode uniqueness（先 read-only collision preflight，再受控迁移计划）；不加 AI                                       | 中英混写、符号 tag 可创建/重命名/搜索；同用户冲突清晰提示；其他用户隔离；无旧 ID/关系丢失                                            |
| 2. 上传后 AI 个人整理             | 只针对 Personal EPUB；工具只看该用户 tags；复用、低风险新建、最多 3 个；有界 retries、不阻断 reader；保存 provenance       | 关闭 provider 上传仍成功；开启 provider 自动标签；重复任务不重复写；手工 tag 不变；删除 AI link 不被重试偷偷加回；不同用户互相不可见 |
| 3. 人工纠正闭环                   | 书籍管理处移除/重命名/调整 AI tag；可查看/撤销本次整理；不做复杂 AI 标签中心                                               | 用户修改后刷新仍保留；重新解析不覆盖手工操作；来源标识易懂但页面不拥挤                                                               |
| 4. Public Discover category pilot | 先确认 SourceRecord API → 当前 Discover 的材料化/卡片边界，再用小型受控 Category 与来源 mapping；先选 Gutenberg 代表书抽样 | Gutenberg 和第二来源样本的 category 可解释；未知 subject 原样保留、不展示为乱类；公共筛选不会泄露/依赖 User Tags；语言切换显示一致   |
| 5. 扩充而非架构先行               | 按真实数据评估 aliases、topic facet、mapping 后台/AI suggestion；无证据不造分类 CMS                                        | 运营者能以可审计方式修正 mappings，重算不破坏 source raw 或用户标签                                                                  |

## 10. 待用户决定

1. **Personal EPUB 自动整理默认值：** 推荐默认为开启（仅在用户启用 AI/provider 可用时），还是先让用户每本书手动点一次？默认开启能实现用户期待的“上传即整理”；显式触发成本与隐私预期更清楚。
2. **AI 新标签是否无需逐个确认直接应用：** 推荐高置信、最多 3 个直接应用且可撤销；低置信只忽略/提示，不弹出一个阻塞对话框。
3. **移除行为：** 用户删除 AI 关系后，推荐本次任务不自动回加；用户点击重新整理时可再次建议。是否接受需要一条 suppression/decision 记录？
4. **来源标识：** 是否接受内部存储创建/关联来源，但 UI 只在整理面板轻量说明，不给普通 tag 列表逐项加徽标？
5. **Discover 首期范围：** 是否同意先由受控 broad Category（建议 6–10 个候选）作为入口，SourceRecord subjects 做 mapping/facet；是否采纳其中具体类别需独立批准。
6. **Unicode 修复：** 允许下一阶段先对开发/测试数据做只读冲突预检并单独提出存量迁移吗？本轮没有查询数据库，不能估计冲突数。

## 11. 结论与证据限制

- 旧 `main` / `dev` 确实实现了 AI 标签和分类生成、查询已有 taxonomy、复用/创建、作品关联和来源标记；测试 mock 了 AI，因此只能定为**源码实现 + mock 测试**，不能宣称真实模型端到端验收。
- 旧能力与 User-first 个人上传不是同一个边界。迁移 0041 移除旧 Catalog taxonomy；当前 User Tags 是新领域，当前 AI enrich 只补公共 Catalog Work 的简介。
- 最小方向是 **User Tags 私有且自由命名 + 来源 raw metadata 原样保存 + 公共 Discover Categories 小而受控 + AI 仅作用户授权范围的个人整理**。不需要一个统一“Tag/Category”巨表，也不需要先完成 Discover 才能恢复个人 AI 整理。
- 本报告不提供数据库现状或真实 provider 运行结果；不调用模型、不接入运行环境。TextStack 的 README 可确认其高层产品声明，但任务指定的六个源码页未能通过网页访问工具读取，因此其内部标签/AI 实现标为 `UNVERIFIED`。各竞品能力按官方文档或 README 的公开描述归纳，方案取舍属于本报告的产品推断。

外部资料最后核查：2026-10-11。没有修改 [`tag-taxonomy-audit.md`](tag-taxonomy-audit.md) 或其他现存用户文件。
