# Frontend Product Experience Baseline

> 审查性质：产品体验与 UI/UX 基线审查；只读运行代码审查。本文是后续讨论输入，不是最终设计方案或实现批准。
>
> Git 基线：`dev-02`，起始 HEAD `e86c724c6ba88f7bcd52bdd5b6b58f18c6981d5c`。
>
> 证据标签：**已确认**表示由当前分支源码或已接受项目记录直接支持；**判断**表示基于这些证据的产品/设计分析；**待定**表示须由产品讨论决定。

## 1. Executive Summary

### Senior Product Manager

**已确认：** 当前前端已经从旧 Shelf 流程推进到 `/library`：页面呈现 Continue Reading、统一 Library 条目、EPUB 上传，以及 processing / ready / failed 三种用户态。Catalog 加入 Library 和 Personal Work 所有权在领域层已有区分；阅读进度和 History 也不等同于 Library 成员。参见 `docs/reviews/user-first/pr-07-library-frontend.md` 与 `docs/adr/001-reading-content-domain-model.md`。

**判断：** 页面已具备真实阅读产品的核心动作，但长期“管理并继续阅读个人内容”的心智仍未闭环。空态正文的主 CTA 只有 Discover；标题栏另有独立的文件选择上传按钮，两者没有组成连续的导入/发现体验。页面没有把 Personal Work 与已保存 Catalog Work 的来源/管理差异解释清楚。处理中条目虽能回到 Library 并继续轮询，却没有可见阶段或上传进度，失败态也没有当前可执行的恢复动作。个人作品删除未提供，不应在 UI 暴露虚假操作。

**判断：** User-first 领域语义已部分进入 UI，但产品文档之间仍有冲突。较早的 `docs/product/prototype-flows.md` 和 `docs/product/mvp-scope.md` 仍用 Shelf 与“加入书架创建 ReadingState”等旧描述；PR-07 与 ADR-001 的目标语义是 Library membership、ReadingState、History 分离。Review Gate 01 已将这类冲突列为待调和事项。实现方案前需要先决定由哪份产品记录更新旧流程描述。

### Senior UI/UX Designer

**已确认：** 当前有一致的暖纸色 token、衬线标题、书封网格、克制动效和响应式壳层。Library 空态、Discover 空态、History 空态复用相近的居中插画 + 标题 + CTA 结构；Continue Reading 有明显主次。组件基础并非临时拼装。

**判断：** Demo 感主要来自“状态与结构偏薄”，不是圆角或阴影：空 Library 接近单一居中提示；上传流程只到文件选择和 API 返回 toast；processing 仅用同一封面做轻度灰化并显示文本；许多真实用户问题（个人内容如何区分、失败后能做什么、Library 增长后如何定位内容）尚没有界面表达。若 Work 没有封面，`WorkCover` fallback 还固定标记为“官方”，Personal EPUB 会产生来源误导。

**运行态结论：Not Runtime Verified。** 已发现 3000 端口的进程，但本轮本机 HTTP 请求连接失败；桌面界面读取连续超时。未观察 Discover、Library、Settings、Admin 的实际页面，也未验证 Desktop / Mobile、Light / Dark。以下视觉结论仅为源码静态审查，不是视觉验收。

### 本轮范围与非目标

- 当前阶段：**调查与基线记录**；没有作出最终 IA 或视觉决策。
- 确认事实：当前 checkout 为 `dev-02` 且起始工作区干净；本轮只检查源码、项目记录和公开竞品页面。
- 本轮不做：任何 runtime、UI、styles、API、schema、tests、auth、providers 改动；不处理 PR-10 / PR-11 Lazy TTS，不开始 Architecture Subtraction。
- 完成标准：记录可定位的页面证据、产品问题、可参考模式、待决事项、运行态边界和组件盘点；仅新增本审查文档。

## 2. Product Maturity Assessment

| 已经像产品的部分                                                                          | 当前仍偏 prototype / demo 的部分                                                    | 原因                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Reader 周边有 Discover、Library、History；登录态、移动底部导航和 Account/Theme 入口清楚。 | Empty state 的正文只有 Discover CTA；Upload 是标题栏独立文件按钮。                  | 新用户虽然能从标题栏导入，但导入与发现没有形成同一层级的空态选择；Personal EPUB 的产品角色不突出。    |
| Library 有 Continue Reading、封面网格、阅读状态、Catalog membership 移除确认。            | Library 长期管理能力与“当前展示列表”之间边界不清。                                  | 当前不呈现来源分组；状态投影不支持排序/查找等决策；API 当前按 48 项限制返回且无分页，需讨论增长策略。 |
| 上传 API、格式/体积校验、Toast、processing 轮询及 ready/failed 呈现已存在。               | Import Experience 缺少选择前后的连续反馈。                                          | Learner 流程没有 Dialog、Drop Zone、上传百分比或可见处理阶段；toast 只说明已开始。                    |
| Settings 已区分默认服务与自有 API，Advanced Provider 字段可折叠，API key 采用密码输入。   | 自有 Provider、Model、purpose mapping、Region 和 Voice 字段仍直接暴露服务配置概念。 | 设置页覆盖用户偏好和接入基础设施两种心智；首次配置后的成功状态与“目前正在使用什么”不够突出。          |
| Admin 有 Catalog、Assets、Config、Taxonomy、Logs 的运营入口和角色检查。                   | 部分文案仍以宽泛“内容管理 / 作品”表达，多个功能横跨不同运营任务。                   | 路由和后端已是 Catalog / instance administration 语义，Shell 顶层标签还不完全显露边界。               |

## 3. Runtime Verification

**状态：Not Runtime Verified。**

| 页面     | Desktop | Mobile | Light  | Dark   | 本轮证据     |
| -------- | ------- | ------ | ------ | ------ | ------------ |
| Discover | 未观察  | 未观察 | 未观察 | 未观察 | 源码静态检查 |
| Library  | 未观察  | 未观察 | 未观察 | 未观察 | 源码静态检查 |
| Settings | 未观察  | 未观察 | 未观察 | 未观察 | 源码静态检查 |
| Admin    | 未观察  | 未观察 | 未观察 | 未观察 | 源码静态检查 |

没有启动、重启 `dev` 服务或改变运行环境。检测到的 3000 端口不可连接；`http://127.0.0.1:3000/library` 的只读请求失败。桌面上下文工具两次超时，无法截图或检查浏览器 DOM。Reader 本体按要求不做大规模重新设计，也未进行运行态审查。

## 4. Competitive Reference

### TextStack

审阅来源：TextStack 官方[公开首页](https://textstack.app/en/)和 [About 页面](https://textstack.app/en/about/)。这是对公开信息的观察，不代表对登录后产品的完整体验审查。

可直接确认：公开首页在顶部提供 Upload 和 Sign in；主内容同时呈现阅读入口、Upload your book、目录搜索及书目数量；并列展示经典书目录。About 页面将功能组织在“让用户继续读完书”的叙事下。

没有登录其账户或运行上传，所以 TextStack 的进度、失败恢复、移动上传和 Library 管理细节均为**未知**。

| 问题              | Gloaming 当前                                     | TextStack 公开模式                           | 对 Gloaming 的启发                                                                            |
| ----------------- | ------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Upload entry      | Library 标题右侧文件按钮；Navigation 没有全局上传 | 首页 header 提供常驻 Upload                  | 可讨论全局稳定入口是否能缩短 Personal EPUB 的发现路径；须考虑登录态和 Reader/Admin 壳层边界。 |
| Empty Library     | 居中插画、标题、单个 Discover CTA                 | 公开首页把上传和浏览目录并列为开始阅读的入口 | 可讨论空态是否并列“导入自己的书”和“发现目录”；不要照搬其首页布局。                            |
| Library density   | 继续阅读大块 + 2/4/5 列封面网格                   | 公开目录直接给搜索和大量书目入口             | 参考“用户能看出内容空间会持续增长”的信号；Gloaming 的列表管理方式仍待决定。                   |
| Processing        | Library 中显示处理文案，无 ingest 百分比或阶段    | 公开资料未说明                               | 无可借鉴的已验证处理模式；不能把竞品宣传文案当作流程证据。                                    |
| Book presentation | Gloaming 使用统一 WorkCover、进度与来源能力差异   | TextStack 公开目录强调作者/题名和丰富目录    | 借鉴书目识别信息的优先级；不引入搜索、PDF、SRS、目标、离线或社交功能。                        |

**明确拒绝作为本轮产品建议的能力：** Collections、Read Later、Reading Goal、Dashboard、Grid/List 切换、PDF、Notes、Social、Bookmarks management、SRS、离线阅读、搜索页面。它们不属于本轮已定义的 Gloaming 范围。

## 5. Navigation

### Desktop

**已确认：** `SiteNav` 共享品牌、Discover / Library / History、主题按钮及 Account menu；`nav-config.ts` 定义 Desktop 顺序为 Discover → Library → History。Settings 经 Account 相关入口到达，不是主目的地。导航没有 Upload action。

**判断：** 桌面导航目的地数少，主次明确，符合阅读优先。若把 Upload 放进顶栏，需产品决定它是全站“导入个人 EPUB”动作，还是只在 Library 意图明确时出现；顶栏空间和 Admin/Reader 排除范围都要一起定义。

### Mobile

**已确认：** SiteNav 保留品牌、Theme、Account；AppShell 的底部导航为 Library、Discover、History、More。More 打开路由/扩展入口。按 `DESIGN.md`，主导航不使用汉堡菜单。

**判断：** 四项底栏结构稳定，但没有显式 Upload 动作。将第五个入口塞入底栏会改变既有导航契约；更合适的候选位置需在“Library 标题区 / More / 全局 modal action”之间讨论，而不能仅由桌面方案推导。

### 全局入口可行性

**待定：** Persistent Upload Entry 的目标人群是有个人 EPUB 的用户。应决定是否在用户可见的常驻 Chrome 放置该入口，以及 Reader、Discover、Admin 与未登录态是否显示。当前 `uploadPersonalEpub` 已由 Library 使用，可复用逻辑这一事实不自动意味着全局入口与页面入口都应存在。

## 6. Library

### Product Audit

**角色目标：** 用户长期保存和继续阅读内容的空间。当前实现聚合“用户拥有的 Personal Work + 明确保存的 Catalog Work”；Continue Reading 与 Library membership / ReadingState / History 语义分开。

**已确认：** `LibraryPage` 消费 `GET /api/library`，若有 current 项则单独显示 Continue Reading，并从普通网格过滤掉该项。用户可从封面/标题进入 ready Work；Catalog 项可通过菜单确认移除。Personal Work 删除没有 UI/API 操作，避免展示不支持的按钮。

**判断：** 有继续阅读与内容架构，但“长期管理”只覆盖浏览、打开和有限的 Catalog 移除。当前无来源区分、Personal 删除、排序和搜索；这不意味着应新增这些能力，而是用户需要决定现有 Library 首要任务是否只是“继续读 + 浏览”。Personal 与 Catalog 在删除/移除上能力不对称，界面需要让操作对象和影响清楚。

### UX Audit

- 正常态：Continue Reading 有唯一突出 CTA；下方统一网格降低来源分区复杂度。
- 空态：只有一个 Discover CTA；上传入口在页面上方，但与空态内容没有组成一个连贯的导入/发现选择。页面无拖拽、文件 drop feedback 或统一 Dialog。
- 上传：文件 input 接受 `.epub`，客户端检查扩展名和 50 MiB 上限，再以 multipart `POST /api/works` 提交。请求成功后 toast 提示开始，并刷新 Library 查询。没有浏览器上传百分比、暂停/取消或元数据复核步骤。
- 处理中：`useLibraryQuery` 发现 processing 条目时每 2 秒 refetch；ready 后卡片可进入 Reader。failed 只显示文案，没有 Retry，因为当前前端契约没有对应操作。
- 成功/失败：网络成功 toast 与 API 错误 toast 存在；ready 是列表状态迁移，没有显式完成仪式或“开始阅读”通知。上传完成、解析失败与元数据缺失需要产品定义各自用户语义，UI 不应显示底层枚举。
- Destructive：Catalog membership 移除有确认，且解释保留进度/历史；Personal Work 删除未支持。

### Visual Audit / Demo Signals

- `LibraryHeader` 标题 + 单个按钮，正常列表与空态共用；页面主内容由 `ContinueHero` 和网格组成。信息架构简洁，但空态缺少第二条产品路径，使初次访问更像“占位首页”。
- 空态使用最大宽度 `max-w-md`、大插画与垂直居中；空 Library 容器额外使用 `min-h-[70dvh]`。宽屏上内容锚点集中且动作单一；是否“过空”需实际窗口截图验证，目前只是源码结构判断。
- Continue Reading 卡片用横向大封面 + 中央文案；移动端变为纵向居中。其视觉份量明显大于下面的 2/4/5 列网格。随着大量内容增长，该 hero 仍会占据首屏，需要决定其优先级而不能仅缩小间距。
- Library 普通网格使用 `grid-cols-2 / md:grid-cols-4 / lg:grid-cols-5`，`WorkCover` 比例 2:3；书名和标签是辅助层级。该层级清楚，但 48 项响应上限/无分页应与增长方案一起核查。
- **已确认的内容错误风险：** `WorkCover` 无图片 fallback 固定展示 `content.bookDetail.sourceOfficial`。Personal EPUB 无 cover asset 时会被显示为“官方”来源。此结论来自组件共用路径，需作为具体语义问题讨论。
- 空态插画与 Discover、History 使用类似构图。统一有助于产品一致性；三页都呈现“居中插画 + 标题 + CTA”也可能形成模板感。要通过视觉运行态确认画幅和留白，不从 className alone 判断为已验收。
- Dark mode 的 token 使用大多是语义变量，但 `bg-paper`、插画填充及封面 fallback 需在 Dark 实机截图确认层级与对比；未做运行态验证。

### Empty State / Upload Possibilities

**Empty Library Drop Zone：可行性判断。** Library 已有空态组件和 file input/上传 mutation，但没有拖放支持。Admin Catalog 的 `works-edit-page.tsx` 内有私有 `EpubDropzone`，具备 drag-over/drop 与文件选择，可供交互细节参考；它绑定 Admin 上传行为，不是 Library 可直接复用的 primitive。可以讨论将 Library 空态作为拖放/点击选择入口，且点击打开统一 Upload Dialog；是否将 Discover 保留为同等入口、Dialog 中展示哪些限制和隐私说明，都是待定设计。

**Shared Upload Dialog：可行性判断。** `LibraryHeader` 持有 file input、验证、mutation、toast；它不是可从 Navigation 直接复用的共享组件。API helper `uploadPersonalEpub()` 可复用，Library query invalidation 与 processing poll 也已存在。Admin Catalog 的 `EpubDropzone` 与 `/api/admin/catalog/works` 流程分离，不应因此并入 learner upload。若全局入口获批，需要一个有明确所有者的统一 learner interaction/state host，保证 Header、Drop Zone 和 Navigation 不各自创建重复请求与反馈；具体共享边界留待设计/架构讨论。

**空态可探索方向（非最终设计）：** “导入 EPUB”与“发现书籍”是否作为并列任务；Drop Zone 是空态专用还是 Dialog 的选择方式；拖入前后何时展示文件名、大小限制和错误。此处不决定最终版式。

### Processing / Motion

**当前链路：** file picker → 客户端格式/大小检查 → `POST /api/works` → success toast → invalidate Library → GET `/api/library` 每 2 秒查询 processing Work → ready 直接进 Reader / failed 显示静态状态。

**为什么像 broken image / placeholder：** processing 卡片继续使用正式 `WorkCover`，只加轻度 grayscale；状态标签位于封面下方，与“这张封面正在变化”没有视觉联系。没有进度、阶段、更新时间或动效。若原 EPUB 没有封面，Fallback 会出现通用封面视觉（并带固定“官方”标签），与失败或未加载图片容易混淆。

**可讨论的 motion：** 低对比单次 skeleton → 封面交接、缓慢且短周期的 soft pulse、或确定进度时的细线 progress。只有后端确实提供可量化阶段/比例时才显示百分比；否则采用诚实的 indeterminate 状态，并遵守 Calm / Editorial / Restrained。拒绝高亮光晕、强 shimmer、假百分比、仪表盘式过程动画。

### Mobile / Dark

**Mobile 源码：** header 按窄屏缩小标题与按钮；继续阅读 Hero 纵向居中；书架两列；底部导航预留 safe-area。未实际观察触控目标、长标题换行、键盘/文件选择返回和滚动首屏。

**Dark 源码：** semantic token 与 `paper` theme 混用；正式 cover 图片和 fallback 需要区分层级。没有 Dark runtime 验证。

### Competitive Comparison

参考第 4 节 TextStack 公开模式。可讨论持久上传入口、空态并列导入与目录发现、长期内容的视觉密度信号；不采纳其额外功能。

### Reusable Components

`LibraryPage`、`LibraryHeader`、`LibraryEmptyState`、`LibraryContinueHero`、`LibraryGrid`、`LibraryBookCard`、`LibrarySkeleton`、`WorkCover`、Button、AlertDialog、DropdownMenu、toast 与 query helper 均已存在。缺少共享 Upload Dialog / Drop Zone / 有进度语义的 ingest status primitive。

### Product Decisions

1. Library 的主工作究竟定义为“继续阅读与浏览”，还是需覆盖个人内容导入与基础管理？
2. 空 Library 中 Upload 和 Discover 是并列主动作还是主次关系？
3. 若添加全局入口，哪些壳层和登录状态显示？
4. processing 使用可核实进度、阶段文案还是 indeterminate feedback？失败是否只告知、提供删除，或未来提供可执行 retry？当前 API 不支持后两项由 UI 触发。
5. Personal / Catalog 来源是否应在日常卡片中直接识别？个人删除与 Catalog 移除的生命周期边界尚未确定。

## 7. Settings

### Product Audit

**已确认：** `/settings` 按 AI / TTS 分 Tabs。两者都支持默认服务与自有 API；用户可配置 LLM Provider、Model、Assist / Translate / Metadata purpose mapping，以及 TTS Region、Voice。秘密输入采用 password type，并展示已保存 key 的掩码信息。

**判断：** 默认服务模式隐藏多数自定义字段，属于有效渐进披露；但是未配置 Provider 时，“添加 Provider”按钮出现在默认/自有模式选择下方，不需选择 Own API 即能看到基础设施动作。Own API 模式下表单仍以 Provider、base URL、wire/model ID、proxy、thinking parameter、purpose mapping 组织，普通用户心智接近 SaaS 接入配置。Settings 兼有用户偏好和 provider infrastructure，应决定是否把高级配置进一步收纳或明确标为自定义选项。

### UX / Visual Audit

- 页面 `max-w-3xl`，AI 与 TTS 顶层 Tabs；Provider Form 的 Advanced 可折叠。层级存在，但 Own API 页面会纵向展开 Providers → Models → Capabilities，每个 purpose 各自保存，容易形成长配置清单。
- Provider 基本字段在桌面双列，TTS Voice 使用三列选择控件；窄屏会折成单列，源码未见横向固定宽度。需要实际 Mobile 检查下拉控件和三组 Voice 字段占屏长度。
- AI/TTS 成功由 toast 表达；AI Mode 切换先显示确认文案和 Save/Cancel；purpose mapping 独立保存；整体反馈分散在 section/row，而非一个清楚的“当前生效设置”摘要。
- 删除 Provider / Model 从列表按钮触发，须核对具体确认与依赖语义；当前源码可见删除 mutation，但本轮不判定其产品后果是否充分说明。
- TTS 默认服务下自有配置表单隐藏；已配置但切回默认时另有保存入口。AI default mode 下 Provider creation entry仍可见；这是逐项能力而非全部字段都常驻。
- Dark mode 使用 `background`、`border-input`、`foreground` 等语义 token；有独立 native `<select>` 样式，尚未运行态验证。

### Product Decisions

1. Settings 是否主要服务“我选择哪种阅读体验”，把 Provider / key / model 作为 opt-in 高级区域？
2. Default / Own API 的切换语义是立即切换、保存后切换还是“当前模式”与“可用 Provider”分开？当前需要确认操作。
3. `Purpose Mapping` 是否保留工程词汇，或以用户任务命名并解释？
4. TTS Region / Voice 是否都属于常规偏好；哪些 Voice 字段是 advanced？

### Source Coverage

`apps/web/features/settings/settings-page.tsx`、`apps/web/features/settings/tts/settings-tts-section.tsx`、`apps/web/features/settings/settings-api.ts`、`apps/web/components/ui/field.tsx`、`input.tsx`、`select.tsx`、`tabs.tsx`。

## 8. Admin

### Product Audit

**当前实现事实：** AdminShell 检查 `user.role`；导航包含 Works、Assets、Config、Taxonomy、Logs，并有返回 Library 的入口。Catalog route 实际为 `/admin/catalog/works`；页面包含上传、状态过滤、预览、编辑、发布/下线、失败重试和未发布 Work 删除确认。Storage、AI/TTS operations、Taxonomy、Logs 是不同 instance-management 工作。

**目标模型（本轮问题中的 User-first framing）：** “Admin = User + Instance Administration”。当前 UI 仍以独立 Admin 工作区呈现 instance/运营任务；它包含用于管理实例数据和配置的工具，但 Shell 的“内容管理”副标题和“作品” nav label 没有说清这是 Catalog 管理。由于实际 route/API 已落在 Catalog domain，不应把 `/admin/catalog/works` 或 `features/admin/works` 的字符串单独当成旧 Article/个人 Work 运行时。

**判断：** 高权限操作和任务区分已形成运营工作台，不等于用户内容管理产品。主要待审的是 Catalog 词汇是否贯穿 shell、page title、upload、筛选和确认信息；同时 Config / Logs / Storage 的行政入口是否按真实任务分组，而不是按实现来源罗列。

### UX / Visual Audit

- Desktop 为左侧 18rem 导航 + 右侧内容；Mobile 用 Sheet 导航。Admin 页独立于 learner AppShell，不共享其手机底部栏。
- Catalog list 有 6 列表格、状态 tabs、行内主状态操作与更多菜单；作品创建页另有自定义 `EpubDropzone`，带键盘触发、drag-over 状态、sha256/重复内容检查，以及 Hashing / Uploading spinner 和带文件名的错误反馈。处理/解析 workflow 以步骤导航表达；失败可呈现错误步骤与后端错误，并在满足条件时重试。它比 learner Upload 更接近运营完整链路，但不是共享组件，也没有实际上传百分比。需通过小屏 runtime 检查表格与 drop zone。
- Taxonomy 采用表格 + Sheet 编辑；Assets 有扫描、清理 job、Summary/Chart/Object Table 等运营状态结构。它们不像 learner 空态模板，密度与任务复杂度相符。
- Admin 失败/空/载入状态已存在多个页面；删除与清理涉及确认/恢复；逐页闭环和危险操作文案仍需统一审查。
- 用户级 Settings 的 Own API 和 Admin AI/TTS Config 在概念上容易混淆；两者权限/对象不同，导航与描述应说明“个人配置”与“实例运营配置”的区别。

### Product Decisions

1. Admin 顶层是否采用“Catalog / Instance”任务分组，还是保留单一运营导航？
2. Shell 副标题与“Works”入口应明确 Catalog 含义到什么程度？
3. User-owned Work 管理是否永远留在 Library，Admin 只操作 Catalog/instance？当前实现如此，个人删除不在 Admin 功能内。
4. user Settings 与 Admin Config 中的 LLM/TTS 信息如何表达权限、范围和影响对象？

## 9. Demo / AI-generated Signals

| 信号                   | 当前证据                                                                | 体验影响 / 判断                                                                                  |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 标题 + 按钮 + 大片空白 | Library Empty 使用 `min-h-[70dvh]`、居中插画和 Discover CTA             | 初次 Library 没有清楚表达导入或持续使用，可能像空壳页面。需 runtime 截图确认实际空白比例。       |
| 空态模板化             | Library / Discover / History 采用类似插画圆底、标题和单 CTA 结构        | 一致性良好，但跨页套模板可能弱化每页任务差异；重点是内容与动作区分，不是移除插画。               |
| 机械网格               | Library 用响应式 2/4/5 列；Discover 采用内容网格                        | 有内容的书封网格符合阅读产品；不单独视为负面。需要验证 cover 尺寸和容器宽度在窄/宽屏的视觉密度。 |
| Settings 长清单        | Providers / Models / Purpose mapping 为连续分节和逐项保存               | 使用进阶者能理解，普通用户可能读成管理控制台；按使用意图分层是产品决策。                         |
| Processing 像占位      | 复用静态 WorkCover、轻度灰度、卡片下方状态字                            | 没有进度阶段或变化反馈，容易被误读为坏封面或空内容。                                             |
| 假来源 badge           | 无封面时 WorkCover 固定显示“官方”                                       | Personal Work fallback 会有语义错误；是本轮明确源码风险。                                        |
| Copy 残留              | 一些 Admin Shell 文案称“内容管理”，works label 泛称“作品”               | 后端与 route 已是 Catalog 管理，文案可能保留广义 CMS 心智。需核实全语言文案后决定。              |
| 默认组件直接拼接       | Buttons、Tabs、Select、Field 与 Tables 多为 shadcn/base-nova primitives | 源码使用默认 primitive 本身不是问题；主要缺口是领域状态和任务关系，不能据此简单归因“AI UI”。     |

## 10. Design Consistency

**一致点：** `DESIGN.md` 定义 Calm / Paper-first / Editorial / Reading-focused；主要页面使用 token、衬线 heading、暖色封面和细分隔线。Learner 导航共享 `SiteNav`，Mobile AppShell 使用四项底栏，主题入口放在顶栏；Library/Discover/History 的加载/空态模式可识别。

**待验证点：** `container` 与 Admin `max-w-6xl` / Settings `max-w-3xl` 是否对各页面内容任务形成适当宽度；Learn page 的长内容与密集表格是否有一致垂直节奏；纸色 `bg-paper`、surface token 与真实 cover 在 Dark 下是否仍有清晰层级；移动端按钮/控件触控尺寸。仅静态源码不能判定这些视觉验收项通过。

**不应借视觉简化推断的行为：** 自动保存、自动上传、自动导航、移除无确认或默认选择都属于产品行为，不是 UI polish。

### Product Completeness Audit

| 页面 / 流程             | 主动作与次动作                                                     | Empty / Loading / Error                                                         | Processing / Success                                              | Destructive / Responsive                                                       |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Discover                | 浏览/打开；加入 Library 在详情路径                                 | 有空态、筛选空态、载入 skeleton 和重试错误态                                    | 无上传处理态；加入结果在详情流程核验                              | Library membership 会影响 CTA；源码有响应式网格，未运行验证                    |
| Catalog Detail / Reader | 打开目录作品；显式加入 Library；阅读章节、AI/翻译/TTS 在 Reader 内 | Detail 有 skeleton 与 unavailable；Reader 有 part skeleton 与 ReaderUnavailable | Library 加入有 pending/toast；Reader 持久化阅读状态并处理章节推进 | 移动端详情有 sticky CTA；Reader 不做大规模重设计；均未运行态验证               |
| Library                 | 打开/继续阅读；导入与去 Discover                                   | 有空态、skeleton、可重试错误态                                                  | 有 processing / failed / ready；成功上传 toast，不含处理完成确认  | Catalog remove 有确认；Personal delete 不存在；有窄屏两列和 safe-area 预留     |
| Upload                  | 选 EPUB；取消由文件选择器处理                                      | 格式/大小错误和 API 错误通过 toast                                              | API 接收后 toast + 轮询；无上传百分比/取消/重试                   | 无删除操作；窄屏和主题未运行验证                                               |
| Settings                | Default / Own API；增删/配置 Provider、Model、Voice                | Loading 与 API 错误可见；没有明显整体空态                                       | 保存状态为 button text / toast；无 processing 概念                | Provider/Model 有删除入口；对应确认语义需专门复核；表单 CSS 响应式，未运行验证 |
| Admin Catalog           | Upload、筛选、编辑、预览、Publish / retry                          | 有 table skeleton、空态、加载错误                                               | Processing statuses、publish/retry toast                          | 未发布 Work 删除有确认；移动端表格需 runtime 复核                              |
| Admin Assets / Taxonomy | 扫描/清理、建改 taxonomy                                           | 各自有 empty、loading、error 反馈                                               | cleanup job/status 可见；创建/更新有 toast                        | cleanup 有 Dialog；delete 语义逐操作确认；移动 Sheet 存在                      |

此表仅检查业务需要的状态是否在源码中出现，不要求每页拥有所有状态。响应式列是源码结构，不等同于移动视觉通过。

## 11. Reusable Component Inventory

| Component / capability        | Current use                                                                     | Quality / evidence                                                                   | Reusable for                                                                         | Gap                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                        | learner/admin actions                                                           | 已有语义 variants、loading 可组合                                                    | Upload、Library、Settings、Admin                                                     | 上传状态/破坏性动作层级需逐页定义                                                                                                                  |
| Dialog / AlertDialog          | auth、移除确认、清理确认                                                        | Base primitive 存在；AlertDialog 用于 Catalog membership removal                     | 未来统一上传确认/说明                                                                | 目前没有 Upload Dialog                                                                                                                             |
| Sheet                         | Mobile Admin nav、Taxonomy edit                                                 | 已用于移动/侧栏编辑                                                                  | 小屏分层任务                                                                         | 不是共享上传表单                                                                                                                                   |
| Drop Zone                     | Admin Catalog `works-edit-page.tsx` 内部 `EpubDropzone`；Library 上传仅文件按钮 | Catalog 有键盘入口、drag-over feedback、busy disabled 和校验错误；组件为本地私有实现 | Admin Catalog 流程自身；可供交互行为参考                                             | Library 与 Catalog 属于不同用户流程；没有 app-wide reusable primitive 或 learner Drop Zone                                                         |
| WorkCover                     | Library、Discover、Continue、Reader 等                                          | 封面/无图 fallback 通用且已有测试                                                    | 用户及 Catalog Work 展示                                                             | 来源徽标不接受来源参数；processing 应避免混淆 fallback                                                                                             |
| WorkCard / LibraryBookCard    | Library grid                                                                    | 行为完整：ready link、状态、Catalog 移除确认                                         | 书目展示参考                                                                         | 目前 item 信息不能表达 Personal 删除语义或 ingest 阶段                                                                                             |
| Skeleton                      | Library、Admin tables、动态 chart                                               | 各自场景已有 loading placeholders                                                    | 继续沿用具体结构                                                                     | 没有统一的 ingest skeleton/progress transition                                                                                                     |
| Progress                      | Continue / Library read ratio                                                   | Inline `role="progressbar"`，只表示阅读进度                                          | 阅读状态展示                                                                         | 不能直接拿来表示 EPUB 上传/解析进度                                                                                                                |
| Loading / Spinner             | Buttons、global shell、Admin operations                                         | 已有组件                                                                             | 按请求阶段反馈                                                                       | Library generic skeleton 仍模拟完整 hero + 网格，即使真实响应可能为空                                                                              |
| Toast                         | Sonner global toaster、上传和 mutation                                          | 成功/失败反馈已在用                                                                  | 请求结果短反馈                                                                       | 不能承担持久处理状态/详细恢复流程                                                                                                                  |
| Tabs                          | Settings AI/TTS、Admin status filters                                           | primitive 与 Admin segmented variant 已有                                            | 设置分区和运营列表筛选                                                               | 不应用 Tabs 掩盖复杂设置 IA                                                                                                                        |
| Input / Select / Field / Form | Settings/Admin/Account                                                          | Field 结构成熟；存在原生 select 和共用 Select primitive                              | Provider、Taxonomy、Account                                                          | Settings 有受控表单与逐项保存混搭；需保持反馈一致                                                                                                  |
| Empty                         | Admin Catalog、Assets、Taxonomy                                                 | 运营页使用 Empty primitive                                                           | Admin 数据空态                                                                       | Learner empty state 是自定义插画块，需任务化而非统一替换                                                                                           |
| Modal upload state            | 无统一宿主                                                                      | `LibraryHeader` 直接拥有 input + mutation；Admin 使用独立 `EpubDropzone`             | 经产品批准后，Library Header / Empty state / Navigation 可复用 learner upload helper | Catalog uploader 与 learner uploader 使用不同端点/生命周期；不可只因文件格式相同就合并逻辑。共享 learner host 需明确重复提交锁、取消/失败/关闭语义 |

## 12. Backend / Contract Gaps

以下是 UI 可见能力边界，不是 API 变更建议：

- **已有：** authenticated `POST /api/works` Personal EPUB upload；multipart `file`；前端 `.epub` 与 50 MiB 检查；`GET /api/library` 提供 `availability`；processing 期间每 2 秒刷新。
- **Learner Upload 未发现：** 上传字节百分比/分块进度、取消上传、服务端可呈现的处理阶段或真实 ingest 百分比；当前 UI 不应伪造这些反馈。Admin Catalog 有前端 hashing / upload busy 状态及服务端 workflow-step 信息，但也没有上传百分比。
- **已知缺少：** Library UI 没有 Personal Work 删除流程；当前没有由 Library 提供的失败重试操作。PR-07 明确不伪造 retry；Personal delete 还牵涉所有权、asset cleanup 与 progress/history 语义。
- **需产品/API 联合决策：** 是否要区分上传失败、EPUB parse failure、metadata workflow failure；若要给 retry 或恢复选项，先确认安全可执行的端点和用户数据后果。
- **响应增长：** 当前 `LIBRARY_ITEMS_LIMIT = 48`，Backend query 使用此上限，`LibraryData` schema 也限制最多 48 项；当前响应没有分页。本轮只将其记录为增长边界，不直接建议搜索/分页功能。
- **来源身份：** 当前 WorkCover fallback 缺少 source 类型输入；属于 UI contract 表达缺口，是否扩展应先确定展示规则。

## 13. Product Decisions Needed

优先级只表示讨论顺序，不表示工程严重度。

### P0 — Library / Upload / Processing

1. Library 核心角色与长期管理范围；空 Library 是否并列导入与 Discover。
2. Persistent Upload Entry 的位置、出现条件和不同壳层行为。
3. Shared Upload Dialog 与 Empty Drop Zone 是否属于同一个 Import Experience；明确成功后进入 Library 的状态迁移。
4. Processing 是否展示阶段；缺少后端进度时采用什么诚实、克制的 indeterminate 反馈。
5. failed Work 的可执行恢复边界；Personal 删除、Catalog 移除区别如何让用户理解。
6. 调和旧 `prototype-flows.md` / `mvp-scope.md` 与当前 Library / ReadingState / History 领域语义。

### P1 — Settings

1. 用户偏好与 Provider / TTS infrastructure 的分层；Default Service 是否应成为普通用户默认主路径。
2. `Purpose Mapping` 等配置术语是否面向任务重新表达。
3. 当前生效配置、未保存更改与逐项保存成功状态如何统一表达。

### P2 — Admin + final consistency

1. Admin shell 的 Catalog 与 Instance Administration 分组及术语。
2. 用户级自有 Provider 与 Admin instance provider/config 的可见区分。
3. Desktop/Mobile、Light/Dark 的运行态视觉验收，以及宽度、密度、Typography、Motion 的最后校准。

## 14. Recommended Discussion Order

1. Library
2. Upload Dialog
3. Processing State
4. Settings
5. Admin
6. Final Visual Pass

本建议顺序不授权实现；每个产品方向在进入实现前仍需明确 decision gate。

## Appendix A. Source Audit Index

至少检查了以下真实组件 / 路径（代码行可能随提交变化）：

- AppShell / Navigation：`apps/web/features/app-shell/app-shell.tsx`；`apps/web/components/navigation/site-nav.tsx`、`desktop-nav.tsx`、`mobile-bottom-nav.tsx`、`nav-config.ts`、`account-menu.tsx`。
- Library / Upload / processing：`apps/web/app/(app)/library/page.tsx`；`apps/web/features/library/library-page.tsx`、`library-api.ts`、`library-public.ts`、`library-empty-state.tsx`、`library-grid.tsx`、`library-book-card.tsx`、`library-continue-hero.tsx`、`library-skeleton.tsx`。
- Cover / discover / detail / reader entry / history：`apps/web/features/work-cover/work-cover.tsx`、`work-cover-tint.ts`；`apps/web/features/discover/discover-page.tsx`、`discover-empty-state.tsx`；`apps/web/features/book-detail/book-detail-page.tsx`、`book-detail-hero.tsx`（含 `BookDetailStickyCta`）；`apps/web/features/reader/reader-page.tsx`、`reader-unavailable.tsx`；`apps/web/features/history/history-page.tsx`、`history-empty-state.tsx`。
- Settings / controls：`apps/web/features/settings/settings-page.tsx`、`settings-api.ts`、`tts/settings-tts-section.tsx`；`apps/web/components/ui/button.tsx`、`input.tsx`、`select.tsx`、`tabs.tsx`、`field.tsx`、`alert-dialog.tsx`、`skeleton.tsx`、`sheet.tsx`。
- Admin Shell / Catalog / Storage / Taxonomy：`apps/web/app/admin/layout.tsx`；`apps/web/features/admin/admin-shell.tsx`、`works/works-list-page.tsx`、`works/works-edit-page.tsx`（含 `EpubDropzone`）、`works/works-api.ts`、`assets/assets-page.tsx`、`taxonomy/taxonomy-page.tsx`、`apps/web/app/admin/config/admin-config-center.tsx`。
- Toast: `apps/web/components/providers.tsx`。
- Product and decision evidence: `DESIGN.md`、`docs/adr/001-reading-content-domain-model.md`、`docs/product/prototype-flows.md`、`docs/product/mvp-scope.md`、`docs/reviews/user-first/pr-07-library-frontend.md`、`docs/reviews/user-first/review-gate-01-summary.md`。

## Appendix B. Evidence Boundaries

- User-facing wording was checked in `packages/i18n/src/messages/zh-CN.json`; full translated-copy parity and responsive screenshots were not audited.
- TextStack facts are limited to its public official pages linked in Section 4; authenticated flows were not reviewed.
- No test, build, or runtime UI verification was run. This document is a static product/UI baseline and is not visual acceptance, implementation approval, or merge readiness.
