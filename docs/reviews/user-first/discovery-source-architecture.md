# Discovery Source 架构决策

**状态：** DS-01 决策完成，供后续实现遵循
**日期：** 2026-10-04
**调查基线：** `dev-02`，`ee22e380288961a43cf389df85c05b3b035d56bb`
**阶段：** 架构决策；本轮没有实现数据库、API、运行时、UI 或测试改动。

## 决策摘要

采用 **Hybrid：本地同步来源元数据，用户有阅读意图时才下载 EPUB**。Discover 的目录记录由独立的 Source Record 承载；只有保存或开始阅读触发导入时，才创建 `ReadingWork` 并进入现有 EPUB ingest 流程。V1 只接 Project Gutenberg。

这条边界让 Discover 查询留在本地，来源暂时故障不会清空目录；同时不把来源里的每条书目变成阅读内容，也不预下载无人阅读的 EPUB。

## 1. Current Repository Capabilities

### 已有能力

- `packages/db/src/schema.ts` 中的 `reading_work` 是阅读内容根实体。`owner_user_id IS NULL`、`visibility='catalog'`、`published_at IS NOT NULL` 才构成当前公开 Catalog Work；`published_at` 是目录可见性的事实字段。`processing_status` 表示内容处理进度，值为 `uploaded | processing | parsed | metadata | ready | failed`。
- 个人 EPUB 上传由 `POST /api/works` 接收文件，再通过 `storeEpubSource`、`createEpubIngestWork` 和 BullMQ `content-parse` 作业进入解析流程。原始 EPUB 存为 `content_asset(kind='origin_file')`，对象存储 key 按 SHA-256 内容哈希组织；`uploaded_object` 通过哈希实现**字节级存储复用**。
- `apps/backend/src/domains/ingest/parser/` 有按 MIME 类型选择的解析器注册机制，现有 EPUB parser 与 Gutenberg Ebookmaker 清理逻辑可解析 Gutenberg 格式。解析器、`ReadingPart`、`ContentAsset`、工作流租约、重试和队列可作为来源内容的 ingest 执行基础。
- `GET /api/catalog/works` 当前通过 `listCatalogWorks` 查询本地已发布 `ReadingWork`；目录详情和 Reader 访问也以可读 Work 为中心。`POST /api/library/:workId` 仅接受公开的已发布 Catalog Work，且用唯一的 `(user_id, work_id)` 约束实现重复保存安全。
- `GET /api/library` 投影用户拥有的 Work 与显式 `user_library_item`。Library 移除不会删除阅读进度。
- 现有 Metadata Fill / AI Metadata Enrich 只面向 ownerless Catalog Work，会从 EPUB 补字段并可能生成描述。来源同步后这些字段属于来源数据，后续导入必须避免 AI enrich 覆盖来源标题、作者、语言、描述或 rights 信息；阅读统计仍可由本地解析结果计算。

### 当前不存在的来源能力

当前代码没有 Discovery Source 配置、Source Record、来源内外部 ID、导入批次、同步游标、来源远程内容 URL 或来源级更新/可用状态。`origin_kind` 的数据库约束仅允许 `NULL` 或 `user_epub`；`origin_meta` 是工作流和上传元数据容器，不是来源同步域。`content_asset.content_hash` 与 `uploaded_object.content_hash` 存在，但没有标题、作者、ISBN 等书目去重。

AS-08 已删除 Catalog 全局 tag/category/source taxonomy。旧 taxonomy 的 `source` 不能充当 Discovery Source 配置、来源身份或书籍 metadata 模型。Subjects、bookshelves、language、authors 属来源提供的 metadata，不属于全局 Taxonomy CRUD，也不属于私人 User Tags。

此外，当前没有运行时流程将 Work 的 `published_at` 设置为非空值。Source 导入后何时使 Catalog 可见，必须由新的来源导入策略明确规定，不能假设现有 Admin 发布流程仍存在。

## 2. External Source Findings

### Project Gutenberg

- Gutenberg 官方没有 JSON REST API。其官方[离线目录与 Feed 文档](https://www.gutenberg.org/ebooks/offline_catalogs.html)提供完整 XML/RDF metadata、CSV、RSS 与 OPDS；官方说明 XML/RDF 每日更新，CSV 每周更新，并建议使用这些机器可读数据而非爬取网页。当前 feeds 索引显示 `pg_catalog.csv.gz` 约 5.3 MB、RDF archive 压缩包约 121 MB；这是 2026-10-04 检查到的大小，不是长期承诺。
- RDF 包含书名、作者、语言、subjects、bookshelves、rights、Gutenberg ID、Gutenberg release date 和各文件格式/URL；它不代表原始纸本版次的出版日期。官方 CSV 较小，但不包含完整 rights 与文件格式记录。下载 EPUB 应根据官方格式记录或稳定的 Gutenberg 书目下载入口确认格式，不能依赖第三方目录 API。
- Gutenberg 的 [Robot Access policy](https://www.gutenberg.org/policy/robot_access.html)要求自动化客户端使用其提供的目录/Feed 和特定文件下载方式，避免爬取人类网页；批量获取内容应使用镜像与规定的间隔。Source 同步只读 metadata feed，不建立 EPUB 镜像。
- Gutenberg metadata 中的版权状态以美国法律为依据；官方[许可说明](https://www.gutenberg.org/policy/license)明确指出有的书是经权利人许可加入，许可不会自动扩展给下游；美国以外的使用者仍需考虑所在地法律，Gutenberg 不保证其他国家的版权状态。保留逐书 rights statement 和上游链接，不把“美国公有领域”转换成全球适用的法律结论。
- [Gutendex](https://github.com/garethbjohnson/gutendex) 是第三方、开源、可自托管的 JSON 服务；它从 Gutenberg RDF 构建易用 API。托管站不是 Gutenberg 官方服务，因此不把其可用性或数据更新作为 Gloaming 运行条件。

Gutenberg 官方也提供 OPDS，但其[离线目录说明](https://www.gutenberg.org/ebooks/offline_catalogs.html)称现有 XML OPDS 预计 2027 年退役，JSON OPDS2 仍处于测试阶段。因此 V1 不以 Gutenberg OPDS 作为同步主协议。

### Standard Ebooks 与 OPDS

- Standard Ebooks 有第一方 [OPDS feed](https://standardebooks.org/feeds/opds) 和 RSS/Atom。其说明指出部分完整目录 feed 的访问需要 Patrons Circle，或由符合条件的开源项目联系取得；这不是一个可无条件依赖的公共完整目录。
- Standard Ebooks 的[馆藏介绍](https://standardebooks.org/about)与[公有领域政策](https://standardebooks.org/about/standard-ebooks-and-the-public-domain)说明其文本基于美国公有领域作品，其自制电子书工作以 CC0 释出，metadata 和校订质量高。地域版权仍需由部署者按具体使用地判断。
- OPDS 是目录分发标准，不是内容来源。Standard Ebooks 是采用 OPDS 的来源；不同来源可以有不同 feed 可访问性、metadata 质量和内容策略。

Standard Ebooks 是后续合理的第二来源，但在 Gutenberg 单源导入与 Source 生命周期形成以前，不应同时交付第二种来源协议。

## 3. Architecture Options

| 维度           | Runtime Remote Search                      | Local Catalog Sync                            | Hybrid（选择）                                                   |
| -------------- | ------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| Discover 响应  | 每次查询受来源延迟和分页限制               | 本地查询，响应稳定                            | 本地 Source Record 查询，响应稳定                                |
| 外部运行时依赖 | 每次 Discover 都依赖来源或第三方 API       | 同步时依赖来源；同步后不依赖                  | metadata 同步和按需导入时依赖；已同步目录可继续查询              |
| 实现复杂度     | 初期较低，错误、限流和来源特性会进入请求链 | 需要来源表和定时同步；Work/来源身份易混在一起 | 中等；Source Record 与 Work 有明确边界，复用已有解析队列         |
| 存储           | 低；远程结果                               | metadata 与内容若一起摄取会持续增长           | metadata 较低；EPUB 只为有阅读意图的作品存储                     |
| 同步与恢复     | 每个用户请求都承担来源故障                 | 快照/游标/下架处理都需同步作业                | 简单完整快照比对即可恢复；内容导入独立重试                       |
| 搜索性能       | 依赖来源搜索能力和限额                     | 本地索引，适合统一语言/作者/全文书目筛选      | 同步后的本地 Source Record 索引                                  |
| 去重           | 跨来源去重常被拖入请求时模糊匹配           | 可做 source + external ID 唯一                | 先来源内唯一，内容按字节复用，不做语义合并                       |
| 下架/更新      | 结果即时变化但来源状态不可控               | 同步后可标记可用性                            | 更新目录 metadata；下架只隐藏 Discover，不删既有 Work 或阅读数据 |
| Self-host      | 受来源 API 服务和策略影响                  | 无需常驻外部 API                              | 实例可独立提供已同步目录；外部仅在同步/导入时需要                |

Runtime Remote Search 不满足来源故障时 Discover 仍可用的目标。单纯 Local Catalog Sync 容易把所有来源书目都转成完整 `ReadingWork` 并存下大量 EPUB。Hybrid 保留本地目录体验，同时把内容存储增长绑定到用户真实意图。

## 4. Chosen Architecture

采用 **Hybrid：本地 metadata sync + EPUB/content lazy ingest**。

```text
官方 metadata feed
  → DiscoverySource 同步
  → 本地 SourceRecord / Discover read model
  → 用户保存或开始阅读
  → 按需下载 EPUB 到 ContentAsset
  → 复用现有 EPUB parse / queue / ReadingPart 流程
  → ReadingWork ready 后进入 Library / Reader
```

Source Adapter 负责将上游目录映射成可检索的 Source Records，并在用户请求后解析/下载来源内容。Adapter 不提供 Admin 人工编书、不把来源 metadata 写成 Catalog taxonomy、不在 metadata 同步阶段下载 EPUB。

## 5. Source Domain

DS-01 决定概念边界，不锁定完整 schema 或字段类型。

### DiscoverySource

表示 Project Gutenberg 或后续来源及其同步运行状态。最小职责为：来源的稳定 key/type、是否启用、当前同步状态、最近成功同步时间、上游快照/版本信息、最近一次错误摘要。V1 来源类型由代码支持范围限定；不做任意 URL、插件、脚本或用户自定义 Adapter 配置。

Admin 可查看、启停来源、触发同步并查看状态/错误。来源凭据如将来需要，由服务端配置持有，不进入客户端。

### SourceRecord

表示一个来源内的外部书目。最小概念字段：所属 DiscoverySource、来源内 external ID、title、author display、language、description、cover URL、来源内容引用/URL、来源 metadata（保留 subjects/bookshelves/rights 等原始或归一数据）、上游更新时间/同步版本、当前 availability，以及可空的关联 `reading_work_id`。

`(source_id, external_id)` 必须唯一。Metadata 不复制成 `tag`、`category`、`source` 或全局 CRUD。V1 保存过滤 Discover 所需的核心字段及来源需要的 rights、subjects、bookshelves 信息；不预设任意 metadata 成为共享 Catalog 维度。

## 6. Source Record vs ReadingWork

选择 **Model B：Source Record 独立存在；实际 ingest 时才创建 `ReadingWork`**。

同步 metadata 不表示 Gloaming 已拥有可阅读内容，不改变 Work pipeline，不创建空壳 Parts，也不把 `processing_status=ready` 当作目录发布。用户需要阅读时，来源记录进入一个可重试的导入流程。只有下载和解析成功后才产生 ownerless Catalog `ReadingWork`，绑定 provenance 与 Source Record；该 Work 由 Source Adapter 自动化进入 Catalog，且必须在 ingest 完成后才设置公开 `published_at`。

Imported Work 的内容是一份已摄取快照。后续上游修订更新 Source Record 的 metadata/更新时间；不静默覆盖已导入 EPUB、Reader Part、用户进度或派生资产。内容更新策略留给后续明确的产品决策。

## 7. Discover Read Model

未来的 `GET /api/catalog/works` 继续作为 Discover 的本地读取入口，不另造平行的 Discover 页面或独立搜索产品。读模型以 Source Record 为书目身份；如已有导入 Work，可附带其 ready/processing/failed 和阅读能力。Source Record 不因自身存在而成为 `ReadingWork`。

Catalog list/detail 的 URI 可保留为 Discover facade，但未来 shared DTO 和保存 API 必须能区分稳定的 Discover/Source Record identity 与实际 `workId`。不可让客户端把 Source Record ID 当成 `reading_work.id`，也不可让 `ReadingWork` 承担远端可用性、来源同步游标或未导入生命周期。DS-02 实现前需设计兼容的 DTO/API 形状，并先更新 shared public contract。

已有 Catalog Works 与来源书目在读模型中共存；来源故障时继续提供最后一次完整同步的本地记录。当前 `published_at` 仍控制真正 `ReadingWork` 的公开可读性，不承担来源书目目录状态。

### DS-02 实现边界：SourceRecord 读模型与显式 API

DS-02 落地本地 SourceRecord 读模型与来源级 Admin/后台 metadata 同步，不改变 Catalog Work 语义，也不切换用户可见 Discover。

- **Shared 契约归属：** SourceRecord 不是 `ReadingWork`，其公开 DTO/查询/响应契约归新的语义子路径 `@gloaming/shared/discovery`（见 ADR-003 模块表）。Shared 只拥有 schema/type，不拥有 ORM 或工作流。
- **显式后端 API：** `GET /api/discover/records` 提供本地列表、搜索（标题、作者显示名、来源 external ID）、分页与显式排序；`GET /api/discover/records/:sourceRecordId` 提供详情。两者与现有公开 Catalog 列表/详情同为公开读接口。
- **身份区分：** 公开 DTO 只以 `sourceRecordId` 表示 SourceRecord 身份；它绝不表示 `reading_work.id`，也不建立 `ReadingWork` 关联。
- **可用性与语言：** 只返回 `availability = 'available'` 的记录；列表默认 English-first（`language=en`），但存储保留上游全部语言，查询不重写或过滤已持久化 metadata。
- **来源级 Admin 与后台同步：** DS-02 包含来源级 Admin 运维面：查看 `DiscoverySource` 状态（enabled、sync status、最近成功时间、错误摘要）并手动触发后台 metadata 同步；同步以可恢复的后台作业运行，不阻塞请求。
- **不变量：** `GET /api/catalog/works` 及其 Work ID 语义保持不变；DS-02 不实现保存意图、Library 成员、`ReadingWork`/`ReadingState`、下载、taxonomy、AI 富化或用户可见 Discover 集成。

### enabled 语义（读可见性 / 手动同步 / 进行中同步）

`DiscoverySource.enabled` 是来源级运行与可见性开关，DS-02 统一实现为：

- **读模型可见性：** `GET /api/discover/records` 与 `GET /api/discover/records/:sourceRecordId` 的 SQL 过滤都要求所属 `DiscoverySource.enabled = true`。禁用来源的 SourceRecord 既不进入公开列表，也无法通过详情读取（按 not found 处理）；记录行本身不删除，重新启用后恢复可见。
- **手动同步：** 禁用来源不能被新 claim。触发接口显式返回 `disabled`（区别于 `already_running`），不排队、不下载、不改变错误摘要。
- **排队后禁用：** 在入队之后、执行之前被禁用的作业会在启动时重新检查 `enabled`；发现禁用即释放 queued 状态回 `idle`，不抓取 Gutenberg，也不记录上游失败，避免状态卡住或伪造失败。
- **进行中的同步：** 不强制中断已开始的同步；它可正常结束。其记录在来源重新启用前仍按上述读模型规则隐藏。

## 8. Save / Read Lifecycle

### Save to Library

选择 **C：建立 pending Library item（来源保存意图），完成导入后再形成正式 membership**。

用户点击“加入书库”后，API 以 `(user_id, source_record_id)` 唯一约束建立或复用 pending intent，并为该 Source Record 启动/复用一个幂等导入作业。UI 立即显示“正在准备”，不会等 HTTP 请求同步下载整本书。导入成功后，在同一可恢复步骤中确保 `ReadingWork` ready、插入 `user_library_item`（沿用 `(user_id, work_id)` 幂等约束）、移除/完成 pending intent；随后 Library 显示正式书目。重复点击复用 pending intent 和同一来源导入状态，不重复创建 Work 或 Library membership。

失败时保留用户的 pending 意图并显示可重试状态；重试复用相同 Source Record 与已存在的部分 Work/资产，依靠现有 workflow token/lease 和存储哈希防止重复解析、重复存储。只有在成功进入可读 Work 后才转为正式 Library membership。取消/移除 pending 意图的交互细节留给 DS-02 产品/UI 方案。

### Start Reading

若 Source Record 尚未导入，Reader 不做同步远端请求，也不创建 `ReadingState` 或自动保存 Library。系统开始或复用同一 ingest 作业，向用户显示 processing；`ReadingWork` ready 且可读后再导航到 Reader。若下载、来源可用性检查或解析失败，显示明确失败和重试；用户仍可留在 Discover。若 Work 已 ready，则直接进入 Reader。

这是异步需求导入；现有 BullMQ、`content-parse`、`processing_status` 可复用，但来源下载/校验/创建 Work 的工作流是新能力。不能把“metadata 已同步”显示为“可开始阅读”。

## 9. Sync Strategy

- V1 初始同步采用 Project Gutenberg 官方机器可读 metadata snapshot，不抓取书目网页，不使用 Gutendex 托管服务。
- 选择 Project Gutenberg 官方压缩 RDF archive 作为 metadata 权威快照，在本地做完整快照比对；不依赖不存在的 delta cursor。当前官方索引中压缩 archive 约 121 MB，而压缩 CSV 约 5.3 MB；CSV 虽小，却缺少逐书 rights 与完整格式列表。选择较大的 RDF 是为了同步时即可过滤出英文文本、可用 EPUB 且 rights statement 明确的记录，避免把不可导入的记录当成可读 Discover 结果。DS-02 以受限探针验证同一 RDF 快照方案的解包内存、导入时长与小型 self-host 的磁盘暂存需求；若超过项目可接受预算，再回到架构决策，不静默切换为缺少这些字段的 CSV。
- V1 同步频率先定为每周一次完整快照对比，另提供 Admin 手动重试；不引入同步游标、外部 webhook 或通用 ETL 平台。仅在完整快照成功解析后才更新本地同步版本并标记本轮缺失记录，避免临时下载/解析失败把目录整批下架。失败保留上次完整目录和错误摘要。
- 已确认不再出现在成功快照的未导入记录标为 unavailable 并从 Discover 隐藏；已导入 Work 保留供已保存用户阅读，绝不因来源下架而删除 Work、Library membership、`ReadingState` 或 History。
- Source-origin Work 使用来源映射的权威 metadata；不运行可能覆盖该 metadata 的 AI Metadata Enrich。Parser 计算的 word count 等阅读统计仍可使用现有逻辑。

## 10. Storage Strategy

Metadata 与 EPUB/content 下载必须分开。定期同步只写 Source Record；EPUB 在用户保存或开始阅读触发后才下载，经现有 SHA-256 `uploaded_object` 和 `content_asset(kind='origin_file')` 存储，再复用 parser。这样 storage 和解析成本随实际请求增长，而不是随 Gutenberg 全目录增长。

精确字节相同的 EPUB 可复用对象存储字节；这不等于共享 Work。Source Record 仍保留每来源 identity，作品来源关系、读取权限和 Library membership 仍按业务 Work 区分。

## 11. Dedup Strategy

- **来源内 identity：** 唯一键为 `(source_id, external_id)`；Project Gutenberg 使用 Gutenberg ebook ID。同步重复运行更新同一记录。
- **跨来源去重：** V1 不做 ISBN、标题/作者模糊匹配、语义相似度或 Source Record 合并。Gutenberg 与 Standard Ebooks 即使来自同一原著，也先视为不同书目与 Work。
- **内容字节：** 可复用现有 `uploaded_object` SHA-256 存储去重。此能力只减少相同文件的对象存储占用，不做跨来源 Work 合并，也不推断 editions 等价。

## 12. Admin Boundary

Admin 只管理 Source 运行状态：enabled、手动触发/重试同步、当前状态、最近成功时间、错误摘要。V1 只有 Project Gutenberg。

Admin 不管理单本书、不编辑来源 metadata、不 publish/unpublish 单书、不创建全局 taxonomy、不做内容审核或人工 Catalog intake。来源内容与 metadata 由 Adapter 提供；单书 rights 原文只作来源证据保留，不变成人工 CMS 编辑字段。

## 13. V1 Scope

- 单一来源：Project Gutenberg。
- 来源 metadata 本地同步、Source Record 身份与 `source + external_id` 唯一性。
- 本地 Discover 搜索/筛选/分页读模型，以英文文本为首批范围；读取本地最后一次成功快照。
- 不把 Source Record 预先建成 `ReadingWork`。
- 保存或开始阅读时按需下载 EPUB，并经现有 storage、内容解析和 queue/workflow 创建 Work；成功后可读，保存意图转为 `user_library_item`。
- 保留逐来源/逐书 provenance、上游 rights statement 和远程内容引用；对 Gutenberg 的美国版权状态及当地法律差异作准确说明，不把 source flag 当作全球法律判定。
- 每周完整 metadata 快照同步、完整成功后比较更新/下架；Admin 有来源级启停、同步、状态和错误查看。

V1 不含批量 EPUB 镜像、来源实时远端搜索、Gutendex runtime dependency、Standard Ebooks、OPDS 通用客户端、跨来源语义合并、自动推荐/排名引擎、Admin 书目编辑、全局 Taxonomy 或大型 ETL 平台。

## 14. Deferred

- Standard Ebooks 作为第二来源，以及 OPDS 1.x/2.x Adapter。
- EPUB 更新时的用户选择、内容版本比较/替换和 reading position 映射。
- 跨来源 duplicate detection / edition linking。
- 高级来源排名、推荐、热度特征和主题 taxonomy。
- 若全量 RDF metadata 快照对小型 self-host 安装太重，重新评估官方 feeds 与有限记录策略；不可偷偷依赖 Gutendex 托管服务。
- 更细粒度的 rights/legal availability policy。具体地域决策需结合部署者需求和法律建议，本架构不代替该判断。

## 15. Next Implementation Step

**DS-02 — Project Gutenberg Source Metadata Vertical Slice**

只实现一条可审阅的 metadata vertical slice：最小 Source/Source Record 持久化、官方 feed 的受限只读导入与可恢复快照同步、本地 Discover 读模型及来源级 Admin 状态。先做小规模协议/文件探针，再确认正式快照来源和每周成本。DS-02 不实现 EPUB 下载/Reader lifecycle、不改现有 Discover UI 流、不引入第二 Source。完成 DS-02 再单独决策 DS-03 的按需 EPUB import、pending Library intent 与异步 Save/Read 流程。

---

## 决策依据与边界

本决策依据当前 `dev-02` 实际代码和本文件 External Source Findings。当前 GitNexus 索引落后 HEAD 17 个提交，本次架构判断以当前 source/call-site tracing 和只读调查为准，不将过期图谱作为证据。本文件只决策目标架构，不宣称 runtime acceptance、migration feasibility 或法律结论，也不授权 DS-02/DS-03 实现。
