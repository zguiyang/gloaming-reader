# Gloaming Public Classification System Design Study

**阶段：** Investigation + recommendation; no implementation.

**基线：** `dev-02` · `c1c153958a82a37767bb2b46c6f6b71f3861d7a3` (2026-10-11).

**范围：** 公共目录分类研究、开源产品实践、AI 分类/维护方案和公开书目场景推演。未修改业务代码、数据库、其他文档或服务；未运行迁移、同步或模型调用。以下 AI 场景是规则推演，不是模型效果测试。

**证据标记：** **FACT** 为来源或当前源码可确认；**INFERENCE** 为结合事实推导；**RECOMMENDATION** 为本报告建议；**UNVERIFIED** 为尚未由运行或模型验证。

## 1. Executive Summary

**RECOMMENDATION — Gloaming 建立小型、平面、类型明确的公共分类词表，供 Discover 浏览；不要把 DDC/LCC 的书架分类号或完整主题词表搬进产品。** 词表分为两个并列的语义维度：

- **Genre / form（体裁与形式）：** 用户问“这是什么样的书”，如科幻、悬疑、童话、寓言、诗歌。
- **Subject（内容主题）：** 用户问“这本书主要讲什么”，如历史、哲学、自然科学、计算机科学。

对用户呈现为少量可见筛选组；分类项本身不设父子树。每个分类以稳定 ID 标识，提供项目当前支持语言的名称、范围说明和同义别名。一本公共书目记录可以关联多个不同维度分类。详细的来源 Subjects、Bookshelves 和具体概念继续作为原始元数据保存，不自动升格为公共分类。

公共分类应归属当前 **Discovery / SourceRecord** 目录边界：分类必须能在 EPUB 尚未下载、ReadingWork 尚未物化时服务 Discover。不同书源的记录可以映射到同一公共分类 ID；当前系统没有跨来源作品身份合并机制，本轮不引入该概念。分类通过 SourceRecord 到 ReadingWork 的现有关联读取，不复制一份分类关系到 ReadingWork，也不写入个人 User Tags。

AI 分类分两类决策：优先给作品复用已有 ID；只有概念稳定、范围清楚、并且现有分类确实不适用时才可自动创建。名称相似但语义不等价、证据不足、或需要推断读者年龄/价值判断时应弃权或进入审查。分类审核 AI 只读分析并产生可解释建议；管理员确认后由受控业务 API 执行编辑、归并或停用。

**主要代价与风险：** 两个维度和多语言名称要求清楚维护定义、别名、来源映射与人工翻译；AI 自动创建仍可能提出错误概念。通过固定 ID、明确分类类型、原始元数据留存、低频创建门槛、数据库唯一约束与可撤销/停用操作控制风险。许可上参考行业方法和开放接口，不复制 DDC、LCC、BISAC 或 Thema 的完整受控词表。

本轮用户已明确允许 AI 创建合格的公共分类；这覆盖之前文档中“AI 不得直接扩张公共词表”的保守建议。当前仍未批准具体首发分类词表、Discover 的呈现粒度以及开发数据导入操作。

## 2. Library Classification Research

### 2.1 成熟体系各自解决什么问题

| 体系                                     | FACT：官方结构/治理                                                                                                                                                                                                                                                  | 对 Gloaming 的参考价值                                                                                                                                                                                                                 | 不应照搬                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dewey Decimal Classification (DDC)       | OCLC 描述 DDC 有 10 个主类，每个主类 10 个 division，再分 section；官方建议从一般到具体沿层级判断，避免过早跳到窄类。[OCLC DDC 主类与层级](https://help.oclc.org/Metadata_Services/WebDewey/WebDewey_Linked_Data/Main_classes)                                       | 用稳定宽类组织知识；先看作品大意和维度，再选合适的具体主题；新增细分要有“literary warrant”，即已有一批作品确实需要该区分。[OCLC 术语表](https://help.oclc.org/Librarian_Toolbox/OCLC_glossaries/Dewey_Decimal_Classification_glossary) | DDC 数字、完整数表和逐级书架结构。DDC 面向跨学科知识与实体馆藏组织，数字并不会让普通读者更容易选书。DDC 为 OCLC 维护的体系，不应假设其完整分类词表可随产品复制。 |
| Library of Congress Classification (LCC) | LOC 的 LCC 有 21 个基本类，按字母大类和子类展开；其层级和更新由 LOC 的政策与合作部门维护，新增与修订会审议并发布。[LOC LCC 说明](https://www.loc.gov/catdir/cpso/lcc)                                                                                                | 稳定的分类需要有明确维护责任、变更审查和版本记录。图书馆采用的分类号是馆藏组织工具，用户界面可隐藏分类号而保留易懂标签。                                                                                                               | 完整字母/数字架构、细密的专业书架编排。LCC 部分完整产品为付费订阅；不可把在线可浏览误认为词表可以无条件复制。                                                    |
| BISAC                                    | BISG 面向出版、书店和销售渠道维护主题标题；网页按大类浏览到更具体标题，提供具体范围和使用说明；把完整词表导入数据库须取得 End User License。[BISG BISAC FAQ](https://www.bisg.org/BISAC-FAQ)、[BISG 词表许可说明](https://www.bisg.org/BISAC-Subject-Codes-main)     | 用通俗、可供发现/选购的标签，而不是馆员分类号。每个类别要写清适用范围；无法精确匹配时先选最接近的已有类，并把新增建议留给治理。                                                                                                        | 不复制完整 BISAC 名称、代码或行业词表；它的许可明确不支持无许可导入。                                                                                            |
| Thema                                    | EDItEUR 管理的国际出版分类方案，包含层级 subject categories 和 qualifier；适合跨国出版目录与零售发现，提供多语言呈现与语言无关代码。[Thema 官方浏览器](https://ns.editeur.org/thema/en)、[BIC Thema 介绍](https://bic.org.uk/resources/thema/)                       | 最接近 Gloaming 的**跨书源和多语言发现**需求：稳定身份与展示名称分离；分类内容和语言、地点、时间等 qualifier 不混成一个超长标签；主要分类可区别于辅助维度。                                                                            | 不复制完整 Thema 表或其代码。使用任何完整数据集、派生映射或本地扩展前，需单独核查当前 EDItEUR 许可条款。                                                         |
| LCSH / LCGFT                             | LOC 将 Subject Headings 与 Genre/Form vocabulary 分别管理；Genre/Form 描述“材料是什么”，Subject 描述“内容关于什么”。[LOC Genre/Form 区分说明](https://www.loc.gov/catdir/cpso/gf_lccn.html)、[LOC LCGFT 说明](https://www.loc.gov/catdir/cpso/genreformgeneral.html) | 强力支持 Gloaming 将**体裁/形式**与**内容主题**作为两个类型，而不是一个无差别标签列表。                                                                                                                                                | 不要求普通读者掌握标题构词和专业交叉参照规则，也不需要引入完整受控词表。                                                                                         |

### 2.2 分类与普通读者书架导航不是同一层

**FACT：** DDC、LCC 是大型馆藏的知识/位置组织和专业编目工具；BISAC、Thema 目标更靠近出版行业发现、商品沟通和跨市场交换。DDC 的 10×10×10 概览与 LCC 的数千细目非常适合专业编目，却会让一个只有几十至几百本作品的阅读产品暴露过多选择。

**INFERENCE：** Gloaming 的 Discover 应把领域分类当作“让普通读者找到下一本书”的导航索引，不作为作品的唯一知识身份；内部保留更细的来源主题，用户只看到稳定、少量、能够预测结果的筛选项。无需显示 DDC/LCC 号码。

### 2.3 分类分层的取舍

分类范围应由真实浏览任务和作品群决定，而不是先复制标准的一级/二级树：

1. 一级范围必须宽到能跨来源复用，且能让读者预测点进去会看到什么。
2. 只有当某个范围内部已经形成多个可辨识、反复出现且读者会主动寻找的子类，才考虑拆分。
3. 细分项继续继承原有稳定身份；不因一部书、作者、流行平台或短期热词建立分类。
4. 上下位不是同义关系。已有“文学”不能代替“科幻”；若当前只有一个可用的宽类，作品可关联宽类，但不得把它记成与窄类等价的别名。
5. 一本书可以在不同维度有多个分类；有多个主题不意味着要把它们拼成一个新复合类。
6. 对跨学科作品，保留最能帮助读者发现的主类，并允许少数真正独立的次类；不展开完整学科组合树。

## 3. Open Source Product Research

下表只记录可由官方文档/源码确认的功能。产品实践不能直接证明其适合 Gloaming，也不据此推测它们的未公开 AI 质量。

| 项目              | FACT：确认的实现/文档                                                                                                                                                                                                                                                                                                                                                              | 设计启示与边界                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project Gutenberg | 书目记录分列 Subjects、LoC Class、语言、Bookshelves 等；Bookshelves 是志愿者人工策划的主题书单，官方说明其已过时且目前不维护；subject headings 通常在新书上架后几周内补入。[书目记录说明](https://www.gutenberg.org/help/bibliographic_record.html)、[示例：Pride and Prejudice](https://www.gutenberg.org/ebooks/1342)、[示例：Frankenstein](https://www.gutenberg.org/ebooks/84) | 原始 subject 既可能较稳定也可能迟到；bookshelf 是策展入口而非权威 taxonomy。原样保存、按来源映射，不将 PG 字符串直接当产品分类。                                                                                                                                               |
| Standard Ebooks   | EPUB 元数据既保留 Library of Congress categories/subjects，也以独立 `schema:genre` 保存 Standard Ebooks subject；从 PG 转制的条目可以保留 PG 来源 subject。[Standard Ebooks 元数据手册](https://standardebooks.org/manual/1.9.1/9-metadata)                                                                                                                                        | 同一本书可以同时有“是什么类型”和“讲什么主题”；保留来源元数据并建立自己的筛选层。当前没有据该手册确认 AI 自动分类或自动新建分类。                                                                                                                                               |
| Open Library      | 官方 Subjects API 可按 subject 浏览 Works；其官方搜索说明指出 subjects 没有正式 master list，同概念书目可能使用不同 subject 字符串。[Subjects API](https://openlibrary.org/dev/docs/api/subjects)、[Search guide](https://openlibrary.org/search/howto/more)                                                                                                                       | 宽松的开放贡献适合广泛检索，但跨书源稳定 Discover 需要归一化 ID、别名和审核。官方 2026 tag-system 代码文档描述的是进行中的规范化工作；未把规划或开发文档当成已全面上线行为。[源码说明](https://github.com/internetarchive/openlibrary/blob/master/docs/ai/tag-system/index.md) |
| Calibre           | 每本书可有多值 tags；用户可编辑标签/元数据，支持用户分类和自定义层级列。[编辑元数据](https://manual.calibre-ebook.com/metadata.html)、[分组/层级](https://manual.calibre-ebook.com/sub_groups.html)                                                                                                                                                                                | 强大的个人管理适合用户自定义，不等于公共目录词表。Gloaming 的 User Tags 应保持自由和私有，不因 Calibre 的灵活模型而并入公共分类。                                                                                                                                              |
| Kavita            | EPUB 的 `Subjects` 映射到 Kavita 的 Genres；筛选支持单/多选 Genres、Collections、Provider 等。[一般元数据映射](https://wiki.kavitareader.com/guides/metadata/general/)、[过滤文档](https://wiki.kavitareader.com/guides/features/filtering/)                                                                                                                                       | 实用的筛选能力可参考，但把所有 Subjects 当 Genre 会混淆“是什么”和“关于什么”。不要从社区文档推断 AI 分类。                                                                                                                                                                      |
| BookLore          | 官方 BookDrop 指南描述导入时读取文件内/文件名基本元数据，可选外部 metadata provider，之后由用户审查并完成导入。[BookLore BookDrop](https://github.com/victor-fong/booklore#bookdrop-folder-auto-import-files-new)                                                                                                                                                                  | 证明“提取/补全元数据后给用户检查”是实际流程；未证明公共 taxonomy、自主创建类别或其运行 AI agent。README 与版本/项目状态会变化，本报告仅引用可见的导入流程。                                                                                                                    |
| Readest           | 官方 Library 文档描述个人书架按标题、作者、标签或系列搜索和组织；同步记录包含个人标签、阅读状态和位置。[Readest Library](https://www.readest.com/docs/library)、[同步字段](https://www.readest.com/docs/sync)                                                                                                                                                                      | 个人组织标签应归属于个人书目/阅读状态而不是公共目录类别；不把 Reader 的个人标签系统当作公共分类实现。                                                                                                                                                                          |

**总结（INFERENCE）：** 这些产品展示了三种各自有效、但不可混用的模式：专业分类号（图书馆）、面向出版发现的受控主题（Thema/BISAC）、个人自由标签与集合（Calibre、Readest、Kavita）。Gloaming 同时需要公共 Discover 分类和私有整理能力，但两者必须保留独立身份、权限和生命周期。

## 4. Classification Principles

### 4.1 Gloaming 公共分类质量规范

一个公共类别必须同时满足：

1. **可理解：** 普通读者不需要编目知识就能理解名称。
2. **定义清楚：** 有一段内部范围说明，指出包含什么，也指出常见排除项；不在前台堆说明文字。
3. **跨书复用：** 不依赖单一作品、作者、书源、读者或短期热点。
4. **对浏览有用：** 分类能帮助找到一组有意义的作品，而不只是描述书目上的一条事实。
5. **维度正确：** 体裁、主题、受众、地点、时代、语言、来源等角色不可被合成同一语义空间；Discover 首期只把体裁/形式与主题作为公共分类维度，其他作书目/筛选属性另处理。
6. **有证据：** 来自来源元数据、作品正文/描述或可靠书目事实；模型不能只由标题联想出身份、受众、价值判断或未证实的内容。
7. **长期稳定：** 适合多个书源和语言；产品实现名可变，稳定 ID 不变。
8. **低频维护：** 只有当现有类别造成实际发现失败，且长期新增概念无法在合理范围内容纳时才新增。按“文学支撑/读者需要”判断，不按书数计量。

名称长度、字母/数字、是否技术概念都不是单独的拒绝条件。`Computer Science` 是稳定学科范畴，可成为主题分类；`React SPA` 是细粒度技术主题，通常保留为详细 subject，除非未来 catalog 中形成明确、长期、用户主动寻找的作品群。`Artificial Intelligence` 可以是稳定主题；模型应根据作品与现有体系范围判断，而非因名称含 AI 自动创建。`Future Robot Love Story` 依赖作品情节组合，不是独立可复用分类。

### 4.2 例子：分类、来源主题和作品描述的边界

| 候选                                | 推荐处置                                                                         | 原因                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 科幻小说 / Science Fiction / Sci-Fi | 同一 genre/form 分类 ID；不同语言名称和别名                                      | 名称表面不同，但核心体裁相同。                                                                          |
| 儿童文学 / 童话                     | 分别作为受众与形式概念，不合并                                                   | 儿童文学问“写给谁”，童话问“是什么叙事形式”；可能重叠但不等价。首期可将 audience 留作 source attribute。 |
| 文学 / 科幻                         | 不视为同义；若“文学”作为过宽入口无发现价值，则不必保留为公共分类                 | 上位/下位关系不能靠复用填补。                                                                           |
| 计算机科学 / React SPA              | 计算机科学可为公共 subject；React SPA 通常为细节 subject                         | 前者跨作品、跨技术、跨来源；后者是技术栈细节。                                                          |
| 人工智能 / 未来机器人爱情故事       | 前者可按目录需求成为长期 subject；后者应标为科幻 + 爱情等已有类别                | 后者是情节元素的临时拼接，不值得发新 ID。                                                               |
| Gutenberg `England -- Fiction`      | 保留原始 subject；可映射到既有地点/历史/fiction 维度，不能直接创建完整字符串分类 | 来源主题有层级和限定语，照搬会产生源特定、过窄词条。                                                    |

### 4.3 如何避免过宽和过细

- 类别过宽的信号：点击后内容杂到无法预测、它与 Discover 的“全部”没有实际区分、或单靠宽标签无法支持用户选择。此时改为维度筛选或不显示，而不是创建更多重复广义词。
- 类别过细的信号：范围等于一个作品/作者/技术版本/地点与体裁的组合；分类只能靠完整句子才解释清楚；没有独立的浏览任务。此时留在原始 Subjects/描述。
- “是否需要细分”由可辨认的用户搜索/浏览需求和已存在的作品集合共同决定。DDC 的文学支撑可作为概念参照，但不设固定书量门槛。
- 删除/合并不是第一步。改名不改 ID；停用前将关联迁至明确目标或保留历史；错误分类需可撤销。

## 5. Classification Model

| 方案                                                   | 用户理解/查找                                                          | 分类覆盖与 AI 难度                                                         | 治理、国际化与跨书源                                                 | 结论                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A. 一个扁平混合词表                                    | 初期一眼能懂；Genre、topic、audience 容易混成同一组，列表持续变长      | 多主题可覆盖，但 AI 需要把不同语义角色互相比较                             | 来源映射和 i18n 容易把 subject、genre 翻译词误合并；扩展时词表难维护 | 不推荐作为最终语义模型。                                                                  |
| B. 完整两级分类树                                      | 点击上位类再选下位类，在超大目录可能有效；对小目录增加层级和空分类导航 | 规则容易理解，但分类父子关系与多学科交叉增加维护和模型判断                 | 跨来源映射需识别树中上下位；升级/本地化和弃类涉及整棵树              | 当前过度设计；若未来某领域自然变大再用有边界的二级路径。                                  |
| C. 平面受控分类 + 明确维度 + 原始详细 Subjects（推荐） | Discover 按“体裁/形式”“主题”各自筛选，名称稳定；不暴露分类号或分类树   | 一个作品可关联多个 ID；AI 先按维度找候选。细节由原始来源主题和常规搜索保留 | ID 共用、名称多语言；来源逐条映射到稳定 ID。新增治理单位简单         | 最适合当前规模：无父子分类树；语义粒度为读者可浏览的稳定概念，来源细节留在 raw metadata。 |

**明确推荐：0 个父子层级（扁平），2 个并列维度。** 这不是把 genre 与 subject 混为一个扁平列表；筛选组、`kind` 和 AI schema 明确区分维度。无需为了层级制造 `Fiction > Science Fiction` 这类包装层。若未来类别数确实让扁平面板变得难找，先让名称/搜索/常用项可用；需有真实读者任务证明后再增加一个子层，避免预建通用树。

推荐首发类别不是已批准清单，也不以固定数量为约束。词表可以从少量常用概念开始，根据真实 catalog 补齐。每个类别的核心词条应当是宽泛稳定概念；具体年龄组、国家、年代、学科子主题和情节细节留在元数据或独立 facet。

## 6. Semantic Reuse Strategy

### 6.1 分类决策结果

模型按以下简单输出作答，并回传可核验的输入证据：

| 结果           | 触发条件                                                                                              | 写入行为                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `REUSE`        | 现有类别与目标概念在**同一维度、同一语义范围**；可以使用别名，但必须选稳定 category ID。              | 关联已有 ID；记录模型/规则版本与可追溯证据。             |
| `CREATE`       | 现有类别都不等价；候选满足质量规范；不是上位/下位或不同维度的误合并；证据足以说明该概念可跨作品复用。 | 在同一原子业务操作中创建唯一类别、可用语言名和作品关联。 |
| `NO_CATEGORY`  | 内容资料不足、分类不影响发现、或多个类别都无法被证据支持。                                            | 不创建、不关联；保持作品可浏览。                         |
| `NEEDS_REVIEW` | 存在真实语义冲突、接近重复、边界或翻译有歧义、可能影响多个作品。                                      | 保留候选和理由；不执行分类或结构变更，等待审查。         |

### 6.2 匹配顺序

1. 根据请求的 `kind` 将候选限定到体裁/形式或主题；不同维度即使文本相同也不是相同概念。
2. 对比所有本地化主名称和别名；正规化 NFC、大小写、空白、标点仅可用于找候选，不得以字符串键判定语义身份。
3. 先按词义、定义、包含/排除范围判断等价，再参考来源 Subject、书名、简介、作者/学科上下文。
4. 若只找到上位或下位概念，不把它作为等价项。可以并列关联已存在的上位项，但如读者需要的窄概念确实具备长期价值，另建稳定子概念，不伪造 `sameAs`。
5. 跨语言名称先由本地化表/别名指向已有 ID；`科幻小说`, `Science Fiction`, `SF小説` 可是一个 ID 的展示名和检索别名。不要按每种语言造一个分类 ID。
6. 相近但不等价的项不合并：`Children’s literature` 与 `Fairy tales` 是不同维度；`History` 与 `Historical fiction` 是主题与形式；`Poetry` 与 `Romance` 不是同类。
7. PostgreSQL 现有关系查询和唯一约束优先。候选词表较小时，把相关 category、localized names、aliases、scope 一次读入 prompt；词表变大后再用数据库文本/别名检索缩小上下文。**不需要向量数据库**，不把 embedding 相似度当作分类身份。

**INFERENCE：** 语义匹配应比“创建类”的门槛更低成本，因为错误的新 ID 会持续污染所有来源。模型不确定时弃权不影响阅读；新增分类错误则会放大到全站。

## 7. AI Category Creation

### 7.1 何时允许自动创建

用户已批准 AI 可自动创建类别，但要满足以下合取条件：

- 明确选定了 genre/form 或 subject 类型；
- 标准化名称表达一个完整、成熟、长期可复用概念，而不是句子、单作品实体、作者、人物、事件、标题关键词或临时热词；
- 目标记录的来源 metadata/描述等证据直接支持该概念；
- 已在现有 ID、跨语言名称、别名和范围中搜索，没有语义等价项；
- 不是可以留在原始 subject 中的过窄细节；
- 新概念将帮助 Discover 浏览；不是仅为了给该作品打满标签；
- 本地化名称生成失败时，至少保留原语言名称并显式标记其他语言未完成，不能伪造翻译或丢弃源名。

不设置“每 100 本只能建几个”或固定全局数量上限。低频增长来自文学支撑、读者价值、范围边界和重复检索，而不是按新增书量计数。单条作品可以支持一个已经成熟的概念，但若该概念只适用于它自身的特殊组合，应返回 `NO_CATEGORY` 或 `NEEDS_REVIEW`。

### 7.2 最小并发和幂等保障

1. 为公共分类 ID 使用稳定主键；为本地化 canonical label/alias 建唯一规范键，但保留字符本身和语言标签。
2. 每次 AI 决策都重新读取当前候选词表；插入前在事务中再次校验同维度、同语言别名是否已存在。
3. 数据库唯一约束作为并发最后防线；如果两个 worker 同时建议相同 label，失败方重新读出并复用已提交 ID，不再创建另一行。
4. “create category + labels + associate SourceRecord + audit provenance”作为一个幂等 use case；由 sourceRecordId + classification policy/version 的任务键避免同一条记录重复生成。
5. 每个模型结果只解析为受校验的结构化结果；未知 ID、越权 kind、空名称、重复 label 或不完整响应都拒绝写入并按 `NO_CATEGORY`/错误处理，不能用 prompt 生成任意 SQL。
6. 对需要全局影响的改名、合并、移除，不由单本分类事务执行。AI 可自动创建，不代表 AI 可随意改动既有分类的历史关联。

**UNVERIFIED：** 当前开发环境的队列、AI provider 成本和每次分类实际 token 消耗未在本研究中测量。第一阶段不得无上限地对全量 Gutenberg 重新跑模型；应先用确定性来源映射覆盖明显项，再对新增/缺失项增量调用。

## 8. Internationalization

**FACT：** 项目当前 `packages/i18n/src/locales.ts` 的 `SUPPORTED_LOCALES` 为 `['zh-CN', 'en-US']`，默认 `zh-CN`。分类实现必须跟随配置，而不是硬编码未来五种语言。

**RECOMMENDATION：**

- 每个分类使用语言无关稳定 ID；至少为项目当前支持 locale 保存人类自然使用的名称。
- 记录每个名称的来源/是否人工编辑（如 source locale、AI、admin），而不是全局标记整个 taxonomy “已翻译”。用户手改文本优先保留；自动任务仅补缺失翻译，不覆盖人工值。
- 多语言 label、转写和同义别名均参与候选检索，但都指向同一 ID；跨语言相似文本只负责找候选，不足以证明同义。
- 创建时优先用源内容语言的自然标签作为 canonical term；AI 可一次生成其他缺失语言。失败时保留原文，并将缺少哪些 locale 显示在管理视图中。
- 前台按用户 locale 展示：精确 locale → 源语言/canonical label → 另一个已有人审校的 label；不能以空字符串或机器回译替代。
- 人工编辑翻译是字段级人工来源，不改变 category ID；翻译不确定且会改变概念时进入 review。

允许个人标签未来复用同一套**文本翻译/名称补全能力**，但不共享分类身份、表、权限或自动创建流程。

## 9. AI Classification Review

### 9.1 最小闭环

**只读分析 → 生成带证据的建议 → 管理员确认 → 受控业务 API 执行。** 不采用自主 Agent 群、向量存储、任意数据库工具、定时全量审查或复杂审批工作流。

**FACT：** 当前 Instance Administration 左侧只有 Assets、Discovery Sources、Config、Logs 四项，没有 Public Catalog 分组或分类维护入口（`apps/web/features/admin/admin-shell.tsx`）。**RECOMMENDATION：** 若批准新增，在现有 `Discovery Sources` 旁边增设一个轻量 `Public Catalog → Categories` 入口，而不是假设已有 Public Catalog 导航、更不是新建 Admin taxonomy 应用。日常分类应自动处理，管理员的页面主要看少量未决建议、翻译缺口和明显质量风险。

### 9.2 只读 Tools

最少三个受限查询工具即可（也可由同一个只读 tool 提供查询参数）：

1. `list_public_categories`：分页获取 id、kind、所有 locale labels、aliases、scope、status、usage count；稳定排序并限制页大小。
2. `get_category_examples`：取几条 sourceRecord 代表项及只读字段：来源、标题、作者、来源 Subjects/Bookshelves、简介片段、当前分类。不得取 Personal EPUB 或私人 User Tags。
3. `find_category_candidates`：按名称/alias/kind 检索候选类别及语义范围；可选按 book counts/filter 获取未关联与低质量类别。

不要提供 SQL、任意 CRUD、删除分类、关联作品、改名、合并或直接调用数据库的 Tool。需要的 counts 可随分页只读 DTO 返回。每次审查限定一个分类页或一批未分类 SourceRecord，并携带总量/页游标；不要将全库书名和 metadata 一次塞进模型上下文。

### 9.3 建议和审查行为

模型建议至少带：`findingType`、涉及 category IDs、简短原因、证据 SourceRecord IDs、建议动作、置信说明、模型/prompt/policy 版本。可以提出：疑似重复、范围过窄、定义冲突、翻译不自然、无使用作品或作品样本不匹配。不要只给一个不可复现的总分。

- 审查建议可先保存在简单的 review run/finding 记录或受控任务日志中；先确认团队是否需要永久保留历史，再决定 schema。不能只用临时聊天文本当生产运营记录。
- 自动执行仅限满足第 7 节条件的**新类别创建和新 SourceRecord 分类**。
- 需要人工确认：改名、翻译覆盖、类别 merge、deprecate/archive、既有大量作品重关联、改变类别边界以及来源映射规则的批量更改。
- 审查入口只需查看建议、关联作品样本和“接受/驳回/稍后”动作；接受后调用固定 API，显示成功/冲突反馈。类别有关联时优先迁移/停用，不硬删。
- 建议可以被拒绝或撤回，不要求“必须清空队列”；少量歧义不阻塞普通作品展示。

**MVP 必须：** 只读审查输入、稳定引用类别/书目 ID、写操作边界、人工确认危险变更。**后续可加：** 发现建议去重、保留历史审查记录。**当前不需要：** Agent framework、向量数据库、taxonomy dashboard、批量审批流或自动删/并类别。

## 10. Domain Integration

### 10.1 身份和关系

**FACT：** 当前 schema 把 `SourceRecord` 定义为由 `(source_id, external_id)` 唯一识别的来源书目事实；`work_id` 是可空的 ReadingWork 关联，并且 unique，一个 SourceRecord 最多链接一个 Work，一个 ReadingWork 当前也不能反向被多个 SourceRecord 共用。`SourceRecord.sourceMeta` 保存原始 `subjects`、`bookshelves`；Gutenberg RDF parser 写入这些字段。SourceRecord API 的详情 ID 明确与 ReadingWork ID 分开。参见 [schema.ts](../../../packages/db/src/schema.ts)、[Gutenberg RDF parser](../../../apps/backend/src/domains/discovery/gutenberg/rdf-parser.ts)、[Discovery DTO](../../../packages/shared/src/discovery/discovery.ts)。

**FACT：** 当前 Web Discover 仍使用 `/api/catalog/works` 的 published ReadingWork 目录路径；后端同时有 `/api/discover/records` 与 `/api/discover/records/:sourceRecordId`，但这些不是同一个身份/DTO。当前只有 Project Gutenberg 的 DiscoverySource 预置路径；跨来源作品去重、等价 Work 聚合没有实现。见 [当前 Discover client](../../../apps/web/features/discover/discover-api.ts)、[Catalog route](../../../apps/backend/src/domains/works/routes/catalog.ts)、[SourceRecord routes](../../../apps/backend/src/domains/discovery/routes/index.ts)。

**RECOMMENDATION：** 公共分类先挂在 `SourceRecord` 目录身份上，逻辑归入 Discovery/Public Catalog；建议关联为 `SourceRecord → PublicCategory` 多对多关系。这样在 lazy materialization 前 Discover 就有分类；同一公共 ID 可由 Gutenberg 和未来 Standard Ebooks 的多个来源记录复用。每个 source 原始 `sourceMeta` 永远保留，不被改写成 canonical value。

ReadingWork 详情如果需要显示公共分类，从相关 SourceRecord read projection 读取，不复制 association；移除 SourceRecord 不应删除 ReadingWork（现有 `ON DELETE SET NULL` 语义不变）。以后发现同一本作品跨来源需要归并时，再做独立的公共 Work identity 决策，不在本轮假设 SourceRecord 与 ReadingWork 一对一已经支持跨源聚合。

### 10.2 与 User Tags 的边界

**FACT：** `user_tag` 由 `user_id` 所有，`user_work_tag` 把一个用户自己的 tag 关联到 ReadingWork；身份、读写权限与公共 SourceRecord 独立。见 [User Tag schema](../../../packages/db/src/schema.ts)。

- Public Classification 是全实例共享的目录信息；User Tag 是个人书架整理词。
- 保存公共书籍后，公共分类不自动变成 User Tag，也不影响用户是否能创建自己的“科幻”标签。
- 给私人 EPUB 的 AI 整理只能使用用户自己的 User Tags，不得写公共分类；给公共 SourceRecord 分类不能读取或修改用户私人标签。
- 不合并数据库表、Domain Service、权限或生命周期。只在经过审批的底层工具层考虑复用 locale labels、候选检索和语义分类组件。
- SourceRecord Subjects、Bookshelves、Reader Bookmarks 是三个不同概念，不进入 User Tags。

### 10.3 AI Provider 与历史能力

**FACT：** 当前 AI runtime `invokeAi` 已支持传入 LangChain structured tools；metadata enrich 当前只选择并写入 description，Public Taxonomy 及其读写工具已移除。历史 `main`/`dev` 实现曾提供 `list_existing_tags` / `list_categories` 工具、AI taxonomy upsert、本地化名称和 provenance，但相关测试 mock 了模型调用，不能证明当时有真实模型分类通过；旧分类写入语义不能原样复活。详见前置 [Metadata & Classification Architecture Review](metadata-classification-design-review.md)。

**RECOMMENDATION：** 重用现有 `invokeAi` 的 resolver/audit/structured output、统一分类输入归一化和 localized-name 生成能力；不恢复旧 Admin Taxonomy CMS 或旧的全局 Tag/Category 数据模型。新增的是 `Discovery SourceRecord → PublicCategory` 的受控工作流及其工具，不是把旧的 `ReadingWork` taxonomy 挂回当前产品。

**UNVERIFIED：** 旧能力对当前 AI provider resolver、user identity 和 prompt 是否可直接兼容，需进入实现阶段逐项检查；历史测试为 mock，不构成部署或分类质量证据。本轮未使用付费 AI，也未调用任何模型。

## 11. Real Book Scenarios

### 11.1 样本与边界

使用公开 Project Gutenberg 记录和 Open Library 记录模拟 **30 本作品**，覆盖文学体裁、童话/寓言、诗歌、旅行、历史、传记、哲学、自然科学、计算机、数学、写作与管理。来源字段缩写：PG = Gutenberg 的 Subject / Bookshelf / LoC Class；OL = Open Library 的 Subjects/genres。分配结果是按本报告规则的研究者推演，不是模型推理结果。

Gutenberg 的书目记录实际展示了原始多值 Subjects、LoC Class、Bookshelves 的不同用途：例如 `Pride and Prejudice` 有 `England -- Fiction`、`Young women -- Fiction`、`Love stories`、`Domestic fiction` 等；`Frankenstein` 同时有 Science fiction、Horror tales、Gothic fiction 和角色/怪物主题；`Alice` 有 Fantasy fiction 和 Children’s stories；`Moby Dick` 同时有 Whaling、Sea stories、Psychological fiction 和 Adventure stories。见 [Pride and Prejudice](https://www.gutenberg.org/ebooks/1342)、[Frankenstein](https://www.gutenberg.org/ebooks/84)、[Alice](https://www.gutenberg.org/ebooks/11)、[Moby Dick](https://www.gutenberg.org/ebooks/2701)。这些来源词不应被当成互相等价的平级 Gloaming 分类。

| #   | 真实书目 / 来源                                                   | 来源元数据里的代表性原词/线索                                                                    | 推演分配给现有/拟议 Public Category       | 新建判断                                       |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| 1   | Pride and Prejudice · PG 1342                                     | Love stories; Domestic fiction; Courtship; Social classes                                        | Romance（genre）                          | 复用；社会阶层保留详细主题                     |
| 2   | Frankenstein · PG 84                                              | Science fiction; Horror tales; Gothic fiction                                                    | Science Fiction + Gothic Fiction（genre） | 两个成熟概念分别复用/创建                      |
| 3   | Dracula · PG 345                                                  | Horror tales; Epistolary fiction; Gothic fiction; Vampires                                       | Horror + Gothic Fiction                   | 复用；Vampires 是细主题                        |
| 4   | The Time Machine · PG 35                                          | Science fiction; Time travel; Dystopias                                                          | Science Fiction                           | 复用；不建 Time-travel-only 类                 |
| 5   | The War of the Worlds · PG 36                                     | Science fiction; War stories; Mars / space warfare                                               | Science Fiction                           | 复用；专门情节主题不升级                       |
| 6   | The Adventures of Sherlock Holmes · PG 1661                       | Detective and mystery stories; Short stories; private investigators                              | Mystery & Detective Fiction               | 复用；短篇集可保留 form 元数据                 |
| 7   | Treasure Island · PG 120                                          | Sea stories; Pirates; Adventure shelf                                                            | Adventure Fiction                         | 复用；Pirates 留为详细主题                     |
| 8   | Alice’s Adventures in Wonderland · PG 11                          | Fantasy fiction; Children’s stories                                                              | Fantasy                                   | 复用；儿童受众不等于 Fairy Tales               |
| 9   | Grimm’s Fairy Tales · PG 2591                                     | Fairy-tale / folklore record                                                                     | Fairy Tales                               | 复用；不得合并到 Children’s Literature         |
| 10  | Aesop’s Fables · PG 11339                                         | Fable title / fable record                                                                       | Fables                                    | 复用；Fable 与童话分开                         |
| 11  | Gulliver’s Travels · PG 829                                       | Fantasy fiction; Satire; Imaginary voyages                                                       | Satire + Adventure Fiction                | 复用；“儿童书”不因后来市场印象推断             |
| 12  | Moby Dick · PG 2701                                               | Whaling; Sea stories; Psychological fiction; Adventure stories                                   | Adventure Fiction                         | 复用；海洋、捕鲸为详细主题                     |
| 13  | Little Women · PG 514                                             | Domestic fiction; Sisters; Family life; Bildungsromans                                           | Coming-of-age Fiction                     | 复用；家庭/姐妹不是新大类                      |
| 14  | Anne of Green Gables · PG 45                                      | Friendship; Girls; Bildungsromans; Canada history -- fiction                                     | Coming-of-age Fiction                     | 复用；人物年龄不强制公开 audience category     |
| 15  | Leaves of Grass · PG 1322                                         | Poetry collection; American poetry context                                                       | Poetry                                    | 复用                                           |
| 16  | The Republic · PG 1497                                            | Political science early works; Utopias; Justice                                                  | Philosophy + Political Thought            | 复用；topic 可多选                             |
| 17  | Meditations · PG 2680                                             | Stoics; Ethics; Life                                                                             | Philosophy                                | 复用；Stoicism 是详细主题                      |
| 18  | The Federalist Papers · PG 18                                     | Government / political theory; U.S. history                                                      | Political Thought + History               | 复用                                           |
| 19  | History of the Peloponnesian War · PG 7142                        | Greece -- History -- Peloponnesian War, 431–404 BC                                               | History                                   | 复用；地点和年代留在 source metadata           |
| 20  | Narrative of the Life of Frederick Douglass · PG 23               | Autobiography; slavery; United States history                                                    | Biography & Memoir + History              | 复用                                           |
| 21  | Autobiography of Benjamin Franklin · PG 20203                     | Autobiography / biography shelf                                                                  | Biography & Memoir                        | 复用                                           |
| 22  | The Interesting Narrative of Olaudah Equiano · PG 15399           | Enslaved persons -- United States/Great Britain -- Biography; Africa/Biographies/History shelves | Biography & Memoir + History              | 复用                                           |
| 23  | On the Origin of Species · PG 1228                                | Evolution (Biology); Natural selection; Biology shelf                                            | Natural Sciences                          | 复用；进化论保留为主题                         |
| 24  | Relativity: The Special and General Theory · PG 5001              | Relativity (Physics); Physics shelf                                                              | Natural Sciences / Physics                | 复用；Physics 为 subject 子范畴的候选          |
| 25  | The Principles of Scientific Management · PG 6435                 | Industrial management; Industrial engineering; Management                                        | Business & Management                     | 复用；React 式技术栈不是同类概念               |
| 26  | The Elements of Style · PG 37134                                  | English language -- Rhetoric / Style; report writing                                             | Education / Writing & Rhetoric            | 复用其中稳定主题；不建“如何写清楚”复合类别     |
| 27  | The First Six Books of Euclid’s Elements · PG 21076               | Euclid / geometry / mathematical treatise                                                        | Mathematics                               | 复用                                           |
| 28  | Around the World in Eighty Days · PG 103                          | Travel / adventure fiction record                                                                | Adventure Fiction                         | 复用；可在未来独立设计 travel facet            |
| 29  | Structure and Interpretation of Computer Programs · OL OL3267304W | Computer science; programming languages; Lisp; Scheme; algorithms                                | Computer Science                          | 复用；多个语言字段不生成多个分类               |
| 30  | Introduction to Algorithms · OL OL4781294W                        | Algorithms; data structures; computer science; programming                                       | Computer Science                          | 复用；不创建 `Algorithms` 直到它有独立浏览价值 |

部分页面为验证具体 source terms，检查了 [Science fiction](https://www.gutenberg.org/ebooks/35)、[War of the Worlds](https://www.gutenberg.org/ebooks/36)、[Sherlock Holmes](https://www.gutenberg.org/ebooks/1661)、[Treasure Island](https://www.gutenberg.org/ebooks/120)、[Little Women](https://www.gutenberg.org/ebooks/514)、[Anne of Green Gables](https://www.gutenberg.org/ebooks/45)、[Grimm’s Fairy Tales](https://www.gutenberg.org/ebooks/2591)、[Aesop’s Fables](https://www.gutenberg.org/ebooks/11339)、[The Federalist Papers](https://www.gutenberg.org/ebooks/18)、[Frederick Douglass](https://www.gutenberg.org/ebooks/23)、[Benjamin Franklin](https://www.gutenberg.org/ebooks/20203)、[Olaudah Equiano](https://www.gutenberg.org/ebooks/15399)、[The First Six Books of Euclid](https://www.gutenberg.org/ebooks/21076)、[Around the World in Eighty Days](https://www.gutenberg.org/ebooks/103)、[The Republic](https://www.gutenberg.org/ebooks/1497)、[Meditations](https://www.gutenberg.org/ebooks/2680)、[Relativity](https://www.gutenberg.org/ebooks/5001)、[Scientific Management](https://www.gutenberg.org/ebooks/6435)、[Elements of Style](https://www.gutenberg.org/ebooks/37134)、[Peloponnesian War](https://www.gutenberg.org/ebooks/7142)、[SICP](https://openlibrary.org/works/OL3267304W/Structure_and_Interpretation_of_Computer_Programs_%28SICP%29) 和 [Introduction to Algorithms](https://openlibrary.org/works/OL4781294W/Introduction_to_Algorithms)。未把整本书内容下载，也未把自动摘要当成确定分类依据。

### 11.2 三轮规则推演

| 推演轮次                    | 输入与起始条件                     | 规则结果                                                                                                                                                                                                                | 观察                                                                                                                                                                     |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1：冷启动                   | 空词表；先处理样本 1–10 的文学作品 | 逐项创建稳定可复用类：Science Fiction、Gothic Fiction、Mystery & Detective Fiction、Adventure Fiction、Fantasy、Fairy Tales、Fables、Horror。既有类后续复用。                                                           | **8 个**不是数量配额，是这组跨作品成熟概念的结果；不创建 fiction、English literature、pirates、vampires、imaginary places 等过宽/过窄项。                                |
| 2：增加文学、历史与社会作品 | 从现有 8 类继续处理样本 11–20      | 复用 adventure/fantasy 等；仅为此前没有的 Satire、Coming-of-age Fiction、Poetry、Philosophy、Political Thought、History、Biography & Memoir 增类。                                                                      | 累计 **15 类**；上下位和人物/主题不重命名为新类别。                                                                                                                      |
| 3：增加理工与教育作品       | 继续处理样本 21–30                 | Franklin/Equiano/Euclid 等复用已有；新领域仅添加 Natural Sciences、Physics、Business & Management、Writing & Rhetoric、Mathematics、Computer Science、Education（若 Writing & Rhetoric 不放在 Education 下则为 7 个）。 | 累计约 **22 类**。另将 30 本来自已覆盖领域、但含新地点/技术/书名/临时热词的记录送入规则检查，预计新增 **0 类**；“React SPA”“Future robot romance”留为详细主题/作品描述。 |

以上是**有规则约束的人工推演**。没有调用模型，不能证明模型会正确执行、不会创建重复项或翻译自然。新增项在首次自动建类前需核对实际目录是否存在反复出现的 browsing need；本表的轮次数字不是生产指标。

### 11.3 覆盖、重复风险与规则调整

- 覆盖了用户列出的文学、科幻、奇幻、童话、寓言、历史、传记、哲学、科学、计算机、教育、诗歌、冒险、悬疑、旅行等方面。
- 同一书可以多类：`The Republic` 的政治理论 + 哲学；`Frankenstein` 的科幻 + Gothic；PG 的 `Subject` 原值仍保留，不以多个 `-- Fiction` 词条创造多个顶级类。
- 主要重复风险不是大小写，而是 genre/topic/age facet 混用，或不同语言翻译被创建为多个 ID。分类 `kind` 与多语言 aliases 是先决条件。
- 体系需允许 `NO_CATEGORY`。PG 的素材偏历史/公共领域，现代软件工程、人工智能内容覆盖有限；来源规模和年代偏差不可被模型推断成产品词表优先级。
- Sample 中 Education/Writing 的归属仍有交叉：这是范围定义需要补充正反例的类别边界，而不是要新增 `English writing for students` 细类。

## 12. Minimal Architecture

### 12.1 概念结构

```text
DiscoverySource ──< SourceRecord >──< SourceRecordPublicCategory >── PublicCategory
                      │                                       ├── labels[locale]
                      └── optional workId → ReadingWork       ├── aliases[locale]
                                                              ├── kind
User ──< UserTag ──< UserWorkTag >── ReadingWork               └── scope/status
```

示意关系，非迁移脚本。MVP 候选数据所有者：

- `PublicCategory`: stable ID, `kind`, status, brief internal scope / include/exclude guidance, timestamps.
- `PublicCategoryLabel`: category ID, locale, display label, origin/edit protection. If labels are stored as a locale map instead of a child table, uniqueness and field-level manual lock still need equivalent guarantees.
- `PublicCategoryAlias`: optional locale-scoped search forms/known synonyms attached to the same ID. Do not add arbitrary transitive broader/narrower/related graphs initially.
- `SourceRecordPublicCategory`: sourceRecord ID, category ID, optional primary marker, provenance (`source_mapping | ai | admin`), evidence/source mapping ref, policy/model version. Unique pair prevents duplicate association.
- Source-native metadata stays unchanged in `SourceRecord.sourceMeta`; there is no taxonomy table shared with User Tags and no new `ReadingWorkCategory` for this phase.

**Minimal implementation choice:** use current `Discovery` ownership and `SourceRecord` IDs, a controlled category/locale-name catalog, one many-to-many association, and deterministic mapping code. Do not introduce a generic taxonomy engine. A category level/parent relation, nested tree, embeddings, and “global work” aggregation are not required to start.

### 12.2 Discover and classification flow

```text
Source sync preserves raw source metadata
  → deterministic known source-term mapping to stable PublicCategory IDs
  → AI receives remaining eligible SourceRecords and current category candidates
  → REUSE / CREATE / NO_CATEGORY / NEEDS_REVIEW
  → constrained backend command validates and persists association
  → Discover list/detail projects category IDs + localized names
```

- Deterministic mappings first cover obvious source-normalized terms; source key remains part of the mapping, because identical raw labels from two sources may mean different things.
- Unknown raw subjects remain searchable/available in metadata and do not become public facets by accident.
- AI should process newly seen or changed eligible records incrementally, not run on every search or page render. Exact scheduling and budget depend on runtime volume and cost, not measured in this study.
- SourceRecord category assignment can exist before materialization. If UI needs a ReadingWork detail projection, derive via the existing SourceRecord link without duplicating storage.

### 12.3 Components to add only in approved implementation

1. Schema/migration and constraints owned by `packages/db`.
2. Shared DTO for public category/association read shape in `packages/shared`.
3. Discovery-owned mapping, classification command, allowed read-only AI tools and Discover API projection in `apps/backend`.
4. Discover filters/display and instance-admin review affordance in `apps/web` only after navigation/IA decision.
5. Category messages/labels and fallback handling following `packages/i18n` locales.
6. Deterministic source mapping fixtures, domain unit/functional tests on `gloaming_test`, localized-label / concurrent-create / duplicate / boundary regression cases.

**Must not add:** generic taxonomy framework, 3+ level hierarchy, vector DB, unrestricted SQL Tools, AI agent fleet, auto-delete/merge, full taxonomy CMS, reprocess-all task, AI-to-User-Tag coupling, work identity merge or a copied proprietary vocabulary.

## 13. Implementation Phases

### Now required — decision and baseline

- Confirm classification dimensions and the meaning/boundaries of the initial common categories.
- Decide the public Discover identity/presentation transition from current ReadingWork Catalog list to SourceRecord list; this affects where category filters live.
- Confirm operational owner for labels, aliases, mapping corrections and automatic create/undo. This is not permission to run a bulk catalog job.

### Phase 1 — stable public category foundation and source mapping

Add controlled category IDs, current locale labels, type and minimal scope definition; associate SourceRecords and provide a Discover projection/filter. Seed only an approved concise vocabulary and deterministic mappings for known raw metadata. Keep unknown source subjects available without inventing categories.

**User acceptance:** Discover reader can filter by readable genre/form and subject names in both `zh-CN` and `en-US`; equivalent source terms show the same ID; unknown metadata does not leak as a new filter; personal tags/private uploads stay separate; category exists before Work materialization.

### Phase 2 — incremental AI reuse and bounded auto-create

Reuse `invokeAi`, structured output and resolver/audit. Provide category candidates and source metadata; default to reuse or abstain. Auto-create only when §7 conditions pass; preserve manual labels, add missing translation only, and make create/association idempotent. Limit processing to newly ingested or changed records and an explicitly bounded retry policy.

**User acceptance:** test representative source terms, translations, synonyms, parent/child and cross-kind near matches; repeated/concurrent requests produce one ID; AI failures leave the SourceRecord browsable; no full corpus reclassification; human-edited locale is never overwritten.

### Phase 3 — AI-assisted taxonomy quality review

Add one read-only audit entry under existing Instance Administration Public Catalog grouping. Return paginated findings with sample SourceRecord IDs and evidence; route confirmed edits through explicit category-management API. Require admin confirmation for all existing-category renames, merges, reassignment and retirements.

**User acceptance:** reviewer can inspect, accept, reject, or defer a suggestion; a rejected/deferred finding does not mutate categories; every accepted change is attributable and can be reviewed; no SQL/database write tool is available to the model.

### Phase 4 — add sources and prove whether more structure is needed

Integrate another source by mapping its raw fields to existing IDs. Measure unresolved terms, manual corrections, Discover usage and category emptiness before considering new facets or hierarchy. Cross-source Work identity is a separate decision.

**User acceptance:** a second provider reuses existing IDs where meanings match, preserves its raw subject fields, and does not create category duplicates simply because labels differ. If no second provider has been authorized/integrated, mark this criterion unverified rather than simulate runtime success.

### Future / not current MVP

- Future: expand stable language set, automatic locale completion, optional primary category ordering, low-volume quality suggestions for merged/misused categories, and richer subject search if measured usage supports them.
- Not now: audience/content warning taxonomies, nested tree, arbitrary aliases graph, many-source entity resolution, public classification of Personal EPUBs, vector retrieval, all-catalog LLM reruns, taxonomy statistics dashboards, autonomous merges/deletions, or new AI operations platform.

## 14. Open Decisions

| Decision                  | Recommendation                                                                                                                                   | Alternative                                                                    | Impact                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover dimensions       | Expose two independent groups: Genre/Form and Subject; do not show an internal numeric classification.                                           | One mixed category panel; or full subject tree.                                | Determines names, `kind`, browse controls, AI candidate filtering and future mapping.                                                                                                 |
| Current Discover identity | Use SourceRecord as pre-materialization public catalog item; derive linked Work details from optional link.                                      | Keep current ReadingWork-only catalog list and classify after materialization. | Determines Discover routes, card IDs/actions and whether unmaterialized books can be classified.                                                                                      |
| AI create boundary        | Permit auto-create for safe new concepts; abstain on ambiguity; admin confirmation for changes to existing IDs.                                  | Admin must confirm every new category.                                         | Changes automation burden, new-category latency and moderation risk. User has already authorized AI creation in principle; exact quality gate/rollback remains to accept.             |
| First category set        | Start from a short, reader-facing seed list only after validating against the current Gutenberg SourceRecord sample; let source mapping fill it. | Seed larger domain coverage for technology/sciences immediately.               | Impacts Discover emptiness, AI re-use rate, i18n work and initial labels. This study did not query development DB, so it cannot claim which current records use a candidate category. |
| Where to review           | Instance Administration → Public Catalog → Categories.                                                                                           | Separate admin destination or delay review UI.                                 | Depends on actual current admin nav and authorized operator flow; does not authorize a large CMS.                                                                                     |

## 15. External Sources and Licensing Notes

- OCLC: [DDC main classes](https://help.oclc.org/Metadata_Services/WebDewey/WebDewey_Linked_Data/Main_classes), [DDC literary warrant](https://help.oclc.org/Librarian_Toolbox/OCLC_glossaries/Dewey_Decimal_Classification_glossary).
- Library of Congress: [LCC](https://www.loc.gov/catdir/cpso/lcc), [Genre/Form vs subjects](https://www.loc.gov/catdir/cpso/gf_lccn.html), [LCGFT](https://www.loc.gov/catdir/cpso/genreformgeneral.html).
- Book industry: [BISAC FAQ](https://www.bisg.org/BISAC-FAQ), [BISAC terms/licensing page](https://www.bisg.org/BISAC-Subject-Codes-main), [Thema browser](https://ns.editeur.org/thema/en), [BIC’s Thema overview](https://bic.org.uk/resources/thema/).
- Digital catalogues: [Gutenberg bibliographic metadata](https://www.gutenberg.org/help/bibliographic_record.html), [Open Library Subjects API](https://openlibrary.org/dev/docs/api/subjects), [Open Library subject variability](https://openlibrary.org/search/howto/more), [Standard Ebooks metadata](https://standardebooks.org/manual/1.9.1/9-metadata).
- Open-source product docs: [Calibre metadata](https://manual.calibre-ebook.com/metadata.html), [Kavita EPUB metadata](https://wiki.kavitareader.com/guides/metadata/epubs/), [BookLore](https://github.com/victor-fong/booklore), [Readest Library](https://www.readest.com/docs/library).

**Licensing caution:** This report uses category-system structure and publicly viewable work-record facts as references, not a copied vocabulary dataset. BISG explicitly requires an end-user license for importing the complete BISAC list. DDC is OCLC’s product; LCC/LCGFT are maintained by LOC with specific distribution materials; Thema has scheme terms governing use. Before bulk-ingesting names/codes or publishing a derived crosswalk, legal/product owners should review the then-current terms. No entire controlled list or schedule is included in this document.

## 16. Final Recommendation

Adopt **a flat, controlled, bilingual, stable-ID set of Public Categories on SourceRecords**, divided into two semantic facets: **Genre/Form** and **Subject**. Let one SourceRecord carry multiple categories. Keep raw source Subjects and Bookshelves, User Tags, and Reader Bookmarks as independent data. Use source-specific mapping before AI, have AI prefer exact semantic reuse, permit high-quality automatic creation with transactional uniqueness and fallback, and use AI review only to recommend changes to existing taxonomy. Require administrator confirmation for changes that can affect many works.

This borrows DDC/LCC’s stable, maintained scope discipline; Thema’s cross-market, multilingual identity idea; LOC’s distinction between what a book is and what it is about; and user-facing selection practice from publishing catalogs. It avoids copying licensed lists, professional call numbers, a deep classification hierarchy, or a legacy Admin-first taxonomy model.

**Main unresolved risks:** incomplete source metadata; cold-start classifications that lack evidence; translations that are literal but semantically wrong; current Discover’s Work-vs-SourceRecord integration split; and the unmeasured token/runtime cost of incrementally processing an actual source stream. All require bounded implementation experiments and real catalog/browser acceptance in later phases. No AI model was used in this study, and no implementation is authorized by this report.
