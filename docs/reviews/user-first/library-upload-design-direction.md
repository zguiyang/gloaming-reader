# Library & Upload Design Direction

> **状态：提案，等待产品讨论。** 本文只定义产品与体验方向，不是实现规格；不改变 `DESIGN.md`、`frontend-design-baseline.md` 或运行时代码。
>
> **审查基线：** `dev-02`，HEAD `9d9f3452e8effe7475cecf7170ef2f50720283ed`。以下现状来自源码审阅；本轮未运行应用或进行运行时视觉验收。

## 1. Design Intent

Library 应像一张持续展开的个人阅读书桌：书本是主体，阅读进度只是帮助回到内容的线索。上传应始终容易找到，却安静地留在产品导航中，不把书库变成管理界面。空书库用一个真实、可操作的 EPUB 投递区域欢迎第一本书，同时把 Discover 保留为另一条清楚但次要的入口。处理中的书仍是书，只是暂时不能打开；其状态应可辨认、可信而不焦躁，并延续 Gloaming 的纸感与编辑式排版。

## 2. Product Role

Library 是用户长期使用的个人阅读空间，主要回答：我正在读什么、我的书有哪些、我如何加入一本书。它承载个人书目与继续阅读的入口，不是文件管理器、Dashboard、Catalog 管理工具或 Collections 系统。

`Continue Reading` 是从进度回到阅读的捷径；`All Books` 是个人藏书的主体。没有正在阅读的作品时，省略 `Continue Reading`，让书目自然上移，不保留空槽。

## 3. Current Problems

以下是当前结构中可由源码确认的问题，不对未运行的视觉效果作事实断言：

- **上传动作放在页面标题旁。** `LibraryHeader` 在页面标题旁渲染文件选择按钮，空、非空、加载与错误状态共用此 Header；这使 Library 标题区域承担了后台式页面操作，也与本轮锁定的干净 Header 方向冲突。
- **空状态仍是通用模板。** `LibraryEmptyState` 以插图、说明和 Discover CTA 为主，没有可投递 EPUB 的真实 Drop Zone。
- **入口没有共享上传对话框。** 页面 Header 自己持有文件 input 与上传 mutation；当前没有用户上传专用、由所有入口共享的 Upload Dialog。
- **处理状态主要靠占位封面与文案表达。** `LibraryBookCard` 对非 `ready` 条目使用不可点击封面与状态文字，缺少明确的“仍在处理”视觉线索。
- **无封面 fallback 会误报来源。** `WorkCover` 的标准无图 fallback 固定显示“官方”；Personal EPUB 无封面时，这个标记并不真实。
- **继续阅读块在结构上接近主视觉面板。** `LibraryContinueHero` 使用较大封面、宽面板与明显内边距；应保留其回到阅读的优先级，同时降低其对首屏书目的挤压。
- **书目卡片元数据有限。** 当前卡片展示标题、标签与状态/实际阅读进度，不展示作者；`LibraryItem` 的 Work 摘要需核对是否具备作者字段，不能在没有数据契约支持时补造作者行。
- **上传百分比与细分处理阶段没有可信数据源。** `apiRequest` 使用浏览器 `fetch`，当前上传 API 没有暴露真实字节进度回调；Library 对外可用状态是 `processing | ready | failed`。因此不应展示伪造百分比或声称精确阶段。

## 4. Design Principles

1. **书先于容器。** 以书封、标题、阅读状态组织内容；卡片和面板只作为承载方式，不新增 Dashboard 式模块。
2. **留白建立节奏。** 用页面标题、章节标题、内容边界和卡片内部层级建立间距，不一概压缩 padding，也不把所有区块拉成同一距离。延续 `DESIGN.md` 的 `container`、8px 节奏、纸面色阶和现有字体，不新增视觉 token。
3. **密度服务于浏览。** 桌面一屏可浏览多本书，封面仍保持可辨认的 2:3 比例；Continue Reading 不能夺走整屏。
4. **动作稳定而克制。** 上传入口跨页面可发现，Library 标题旁不重复放上传按钮；每个区域只突出一个主要动作。
5. **状态真实且就地。** 选择/上传状态由 Dialog 表达；服务端处理状态附着在对应 Library 条目上；百分比与阶段只展示后端或浏览器真实提供的数据。
6. **交互可发现且可访问。** Drop Zone 同时支持拖放和点击选择，也要有键盘入口、焦点样式和清晰的文件错误；拖放不是唯一操作方式。
7. **动效近乎不可见。** 只在用户触发的状态变化处使用轻微、短促的反馈；处理动画低对比、不制造紧迫感，尊重减少动态效果设置。
8. **响应式不等于缩小桌面。** Mobile 保持单一清晰任务、足够触控尺寸与自然纵向节奏，不把桌面长按钮压缩后塞入底部导航。

## 5. Proposed Information Architecture

### Desktop：非空 Library

```text
AppShell / SiteNav
  品牌与主导航                         上传 EPUB · 主题 · Account

Library

Continue Reading                  （仅存在可继续阅读作品时出现）
  当前作品 · 实际进度 · 继续阅读

All Books
  个人书目网格
```

`Upload EPUB` 是导航层级的稳定产品动作。Library 页面标题区域只负责命名页面，不重复承载上传操作。

### Empty Library

```text
AppShell / SiteNav
  品牌与主导航                         上传 EPUB · 主题 · Account

Library

EPUB Drop Zone
  将 EPUB 拖到这里，或点击选择文件
  支持格式与大小限制（简短说明）

Discover → 浏览并添加可读内容
```

Drop Zone 是空书库的主要动作区域；Discover 是另一条获取内容的路径，以次级文字链接或轻量按钮呈现，不与上传做两个同等重量的大 CTA。

### Mobile 原则

沿用现有顶部 SiteNav 与四项底部导航，不增加底部主导航项。上传作为顶部独立、易触达的短动作；空书库仍先呈现可点按的 Drop Zone，Discover 紧随其后。非空页先显示标题与可选的紧凑 Continue Reading，再进入书目网格；不使用横向溢出的 Desktop 工具栏。

## 6. Global Upload

### Desktop

建议在 SiteNav 右侧操作组中，将文字动作 **“上传 EPUB”** 放在主题切换之前、Account 入口之前：`上传 EPUB → Theme → Account`。格式名能设定预期，也避免含义不清的“上传”。采用现有次级/描边按钮风格与小型 Upload 图标，不用实心主色填充；全局上传虽稳定可见，但不应与当前页面主内容争夺主 CTA。保持 Theme 与 Account 的既有顺序和导航视觉契约。

这会扩展共享导航动作，而不是给 Library 加一个专属 header 按钮；未登录场景沿用现有账户/认证规则，不在本提案中重新定义授权行为。

### Mobile

建议在顶部导航中使用一个 36px 左右的轻量 `+` / Upload 图标按钮，置于 Theme 之前，提供 `aria-label="上传 EPUB"` 与可见焦点。图标若表达不清，则用“上传”短标签的紧凑入口；不要照搬 Desktop 长按钮，也不要新增底部 tab。把 Upload 放进 More 会降低发现性，因此不作为首选方向。

## 7. Upload Dialog

Global Upload 与 Library Empty Drop Zone 必须打开同一个 Dialog 实例/流程，并共享所选文件、校验、上传状态和错误状态。空状态区域收到外部文件拖放时，应将文件带入该 Dialog，而不是另起一套上传逻辑。

| 阶段           | Dialog 职责                            | 体验方向                                                                                      |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Entry          | 接收任一入口打开请求，可附带待处理文件 | 无预选文件时显示清楚的选择/拖放区域；有文件时直接进入校验结果                                 |
| File selection | 打开系统文件选择器并显示文件名         | 只接受 `.epub`；当前上限为 50 MiB；选择后仍允许在上传前替换                                   |
| Drop           | 支持 Dialog 内拖放                     | 拖入时只给 Drop Zone 轻微焦点/背景变化，不放大、闪烁或制造彩色光效                            |
| Validation     | 检查格式和大小并说明具体错误           | 文件名、格式/大小问题就地显示；不要先上传再报可预防的错误                                     |
| Upload         | 提交个人 EPUB，表现请求进行中          | 当前没有真实字节进度时显示 indeterminate 状态与“正在上传 EPUB”；禁止估算百分比                |
| Failure        | 表达请求失败并允许用户理解下一步       | 保留已选文件，显示可读错误与“重试/更换文件”入口；仅当实际上传请求可重试时提供重试             |
| Completion     | 确认服务端已接受文件                   | 用简短确认说明作品正在书库整理；Dialog 可收起，提供“查看书库”作为明确选择，不强制离开当前页面 |

**状态归属：** Dialog 管理文件选择、校验、网络上传及该请求的错误/成功确认。上传请求成功后，后端处理生命周期不继续占用 Dialog；Library 条目负责显示处理中、就绪或失败。若用户在非 Library 页面上传，成功后不自动导航；由用户主动选择查看书库。

**原语现状：** `components/ui` 下发现 `AlertDialog`、`Sheet`、Button 等基础组件，但没有通用 `Dialog` primitive 文件。本提案确定产品体验必须是 Dialog；后续实现阶段需先确认现有依赖提供的可访问 Dialog primitive，再决定是否新增本地封装，不能把 Admin dropzone 当作替代品。小屏可以采用同一 Dialog 体验的全屏/近全屏呈现，但文件与状态流必须一致。

## 8. Processing Work

当前 Library 对条目只暴露 `processing | ready | failed`。`uploaded`、`parsed`、`metadata` 是目标生命周期中可用于后端映射的阶段名，但目前不能假定前端可区分它们。默认以单一而诚实的“正在整理这本书”呈现 `processing`；只有未来 API 明确暴露稳定阶段后，才考虑映射阶段文案。

| 状态       | Library item 表现                                                                      | 交互与真实性                                                                                    |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Uploading  | 由 Upload Dialog 显示文件名与 indeterminate 状态                                       | 如果未来获得真实字节总量与已传字节，才展示真实百分比；当前不能展示精确百分比                    |
| Processing | 条目保留真实标题，封面区域显示纸面色 skeleton/安静的慢速扫光，旁边显示“正在整理这本书” | 不可打开；不显示坏图标或假封面来源，不模拟 37% 等进度；不显示未暴露的解析阶段                   |
| Ready      | 真实封面可用时显示封面，否则使用不带来源徽标的中性文字封面；恢复打开阅读               | 处理态到就绪态以短暂淡入/色彩过渡完成；阅读进度只在有真实 `ReadingState` 时出现                 |
| Failed     | 保留书名并用低调但可读的错误状态说明处理失败                                           | 不伪装成普通占位书；不承诺当前没有的重试/删除能力。若后端未来提供恢复动作，再定义与之匹配的控件 |

处理态不能只把封面整体变灰后放一行状态文字。建议在 2:3 封面区域内部表现低对比纹理/扫光，同时将状态文案放在标题元数据下方，形成“这本书正在工作”的稳定线索。动画应局限在该条目，不带动整张网格。

## 9. Spacing & Rhythm

沿用 `DESIGN.md`：页面继续使用带内建 gutters 和 1200px 上限的 `container`；不在同一节点叠加额外水平 padding。以下均为层级建议区间，基于 8px 节奏，不是新的最终 pixel token。

| 关系                           | 建议区间                             | 目的                                                                                               |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Navigation 底部 → 页面内容顶部 | Mobile 24–32px；Desktop 32–48px      | 页面进入内容的缓冲；现有 Shell 的 `py-6` / `md:py-12` 是起点，视觉验证后再微调，不额外重复容器留白 |
| Page Title → 第一个区块        | 24–32px                              | 让 Library 标题明确属于页面，同时让内容较快进入视野                                                |
| Continue Reading → All Books   | 40–56px                              | 区分“回到当前阅读”和完整藏书；若没有 Continue Reading，All Books 直接承接标题                      |
| Section Title → 内容           | 12–16px                              | 标题与网格/阅读项形成紧密组群                                                                      |
| Drop Zone 内图标/主文案/说明   | 8–16px                               | 保持内容短而清楚，不堆辅助段落                                                                     |
| Drop Zone → Discover           | 24–32px                              | 以距离表达主次；避免两个同权重的大按钮                                                             |
| Grid 列间距                    | Mobile 16–24px；Desktop 24–32px      | 保持封面呼吸感，桌面最多延续当前 5 列方向，不为密度挤成小缩略图                                    |
| Grid 行间距                    | 24–32px                              | 给标题与状态留出纵向呼吸，同时维持扫描节奏                                                         |
| 卡片内部：封面 → 标题/元数据   | 8–12px                               | 封面与书目文本作为一个整体阅读                                                                     |
| 标题 → 标签/状态               | 4–8px；状态之间可用 4–8px            | 降低标签与进度的视觉重量，保持两行标题可读                                                         |
| 卡片宽度与网格                 | 使用完整 `container`，内置边距不重复 | Library 属于可用全宽浏览的书目；长标题仍依靠 line-clamp，而非整体收窄成阅读栏                      |

空书库的 Drop Zone 在首屏标题下方，建议以约 42–48rem 为宽度上限并在容器内居中；Desktop 高约 10–13rem，Mobile 高约 9–11rem，随文字换行可自然增长。它应是醒目的主交互面，而不是高占比 Hero；避免现有空态 `min-h-[70dvh]` 把内容推到垂直中心而让上传入口远离页面标题。Mobile 保留足够触控面积，Discover 仍在首屏或紧邻其后。

## 10. Continue Reading

保留在 All Books 前方，但缩小为“继续阅读条目/轻量面板”，不是大型 Hero Banner。推荐继续使用单行横向关系：小封面、书名和实际进度信息、一个清楚的“继续阅读”动作。封面方向约为 Desktop 72–88px 宽、Mobile 56–64px 宽；标题与 CTA 是层级焦点，进度用细线或简短真实数值辅助，不额外叠加徽章。

相较当前 `w-32 / w-36` 封面与 `p-6 / p-8` 大面板，应明显降低高度和视觉面积（目标约缩短四分之一至三分之一，最终需运行时验证），同时保留够用的点击区与封面识别。移动端先尝试紧凑横向布局；仅在极窄宽度确实拥挤时才让 CTA 换行，避免默认变成纵向大卡。无正在阅读的条目时整个区块不渲染。

## 11. Work Grid

- 保持书封 2:3 比例和当前从 Mobile 两列、Desktop 最多五列的方向；列数随可用容器宽度变化，不添加 Grid/List 切换。
- Desktop 用足 `container`，但不单纯追求更多列；当前 5 列上限是合适起点。按上一节的横纵间距区间调节，使封面保持可辨认。
- 标题最多两行；标题之后展示已有且有意义的标签/状态。作者信息仅当现有读取模型真实提供可展示作者时考虑，本轮不提出 API 扩展，也不以标签冒充作者。
- 仅当确有 `in_progress` 状态与真实 `progressRatio` 时显示阅读进度线；未开始的书不出现空进度条。完成态用精简状态文字，不增添统计仪表。
- hover 仅保留轻微上移/文字色变化；触屏不依赖 hover。键盘焦点必须可见。
- 移除/管理操作维持次要位置与现有权限条件；不增加删除按钮、Retry 假控件、筛选、Collections 或管理工具栏。

## 12. Motion

| 动作                                           | 为什么动                                     | 何时停止                                                       |
| ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Drop Zone drag-active 轻微背景/边框变化        | 确认文件确实落入可接收区域                   | 指针离开、drop 或取消时立即还原                                |
| 文件提交中的 Dialog spinner/indeterminate 指示 | 反馈网络请求仍在进行                         | 请求结束、失败或 Dialog 卸载时停止                             |
| 处理中封面的低对比慢速扫光/轻柔 shimmer        | 把 processing 表达为主动状态，而不是破损封面 | 条目离开 processing、失败、不可见/卸载或启用减少动态效果时停止 |
| ready 封面进入的轻淡入                         | 让状态转换可感知                             | 一次短过渡后停止；不循环                                       |
| Continue/书卡 hover 的微小位移或颜色变化       | 指示可交互                                   | pointer 离开立即回到静态状态；触屏不持续动画                   |

整体遵循 `DESIGN.md` 的近乎不可见 motion。建议一次性交互转场约 160–240ms；处理扫光若使用，采用低对比、约 2–3 秒的慢周期并限制在封面内。避免发光、闪烁、强脉冲、多色渐变、整页骨架闪动与游戏化加载。系统减少动态效果时，停止循环扫光并保留静态处理中状态。

## 13. Competitive Patterns

TextStack 的公开首页在顶部提供 Upload，并在首页同时呈现阅读入口、上传入口与可浏览内容；项目说明将个人上传列为 EPUB/PDF 并注明自动解析。可借鉴的是上传入口持续可见和个人导入作为阅读主流程的一部分。公开页面没有充分展示登录后的私有 Library 密度、Drop Zone 尺寸、对话框状态或处理卡片细节，因此不对这些细节作推测。参考：[TextStack 首页](https://textstack.app/en/) · [TextStack 项目说明](https://github.com/mrviduus/textstack)。

| Pattern                         | Competitor usage                                             | Relevant to Gloaming                             | How to adapt                                                                      |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Persistent Upload               | TextStack 首页顶部显示 Upload，另在首屏提供 Upload your book | 有用：上传应稳定可发现                           | 在 Gloaming AppShell 导航中保留一个轻量动作；Library 正文不重复按钮               |
| Upload 与发现并列               | 首页同时给出阅读/上传入口与可浏览内容                        | 有用：个人导入与 Discover 都是获取阅读内容的方式 | 空 Library 以 Drop Zone 为主要路径，Discover 为次级路径，保留两者而非复制首页布局 |
| Library 产品组合                | 项目说明描述个人上传与 curated books 同属 Library            | 有用：个人书和目录书可共同构成阅读空间           | 保持 Gloaming 自己的 Library 域模型与书目语义，不照搬其目录呈现                   |
| 私有书库密度/Drop Zone/处理状态 | 公开材料不足以确认                                           | 未知，不能据此当作模式                           | 以 Gloaming 当前组件、契约和真实状态为依据设计                                    |
| 额外产品功能                    | TextStack 描述 PDF、统计、离线与其他工具                     | 不适用于本轮范围                                 | 不引入 PDF、Goals、Dashboard、Read Later、Collections、Grid/List 或其他未定义能力 |

TextStack 仅作为成熟度参考。目标是让 Library 更像 Gloaming：延续现有排版、暖纸面、ember 强调色、导航和 WorkCover 语言，不复制竞品结构。

## 14. Reuse Plan

| Existing component                                                     | Reuse directly                                       | Extend                                                      | Do not reuse                                                                 | Reason                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `AppShell` / `SiteNav` / `nav-config`                                  | Shell、导航层级、Theme 与 Account 现有关系           | 在共享导航加入全局 Upload 动作；桌面文字、移动图标入口      | 不把上传做成新的底部 tab 或 Library 专属 header action                       | 全局稳定发现且遵循导航 SSOT                                          |
| `Button`、现有 icon/焦点样式                                           | 现有语义按钮与尺寸体系                               | 仅组合合适的轻量次级样式                                    | 不新增一套上传按钮视觉语言                                                   | 保持控件与主题一致                                                   |
| `Sheet` / `AlertDialog`                                                | 仅在语义确实匹配时使用基础行为                       | 后续确认可访问 Dialog primitive 后形成用户上传 Dialog       | 不把确认型 AlertDialog 或 Admin dropzone 直接当完整 Upload Dialog            | 目前没有通用 Dialog 文件；上传包含多个状态，不是简单确认弹窗         |
| `LibraryHeader` / `LibraryPage`                                        | 页面数据加载、页面标题、状态组织                     | 移除 Header 上传职责；容纳共享 Dialog host 与空/非空内容    | 不保留标题旁上传按钮                                                         | 页面 Header 应保持干净，上传由 Shell 提供                            |
| `LibraryEmptyState`                                                    | Library 空数据判定与页面语义                         | 改为 Drop Zone 主区域 + Discover 次级入口，并可接收拖放文件 | 不保留纯插图模板作为主要获取动作                                             | 当前 empty state 没有真实上传投递面                                  |
| `uploadPersonalEpub`、`personalEpubValidationError`、`useLibraryQuery` | 复用现有个人上传 API、格式/50MiB 校验与 Library 刷新 | 由共享 Dialog 统一调用与表达结果                            | 不复制上传请求或加入未经授权的 API 行为                                      | 保持单一业务流与契约                                                 |
| `LibraryBookCard` / `LibraryGrid`                                      | 复用书目数据、阅读链接、权限与网格组织               | 处理中/失败封面表现、真实状态层级与节奏                     | 不增加未经支持的 retry/delete/filter 控件                                    | 条目是服务端处理状态的正确归属                                       |
| `LibraryContinueHero`                                                  | 继续阅读数据、实际进度、Reader 跳转                  | 缩小封面与面板高度，压低视觉权重                            | 不继续强化成大 Hero                                                          | 继续阅读重要但不应挤压书目                                           |
| `WorkCover`                                                            | 有图封面和现有纸书视觉语言                           | 无图 fallback 改为来源中性；处理封面需能表达处理中          | 不默认展示“官方”来源徽标，不用破图占位伪装来源                               | 无封面不等于官方来源                                                 |
| `Skeleton` / `Spinner` / 实际阅读进度显示                              | 复用语义基础组件；阅读进度只展示真实 `ReadingState`  | 组合出低对比处理态                                          | 不拿阅读条伪造上传/解析百分比                                                | 区分阅读进度与上传进度                                               |
| Admin Catalog `EpubDropzone`                                           | 可参考键盘/拖放/验证错误等交互经验                   | 将通用经验翻译为个人书导入语义                              | 不复用组件、workflow steps、hashing/reuse catalog 逻辑、Admin API 或管理文案 | Admin Catalog ingestion 与 Personal Library ingestion 的产品含义不同 |
| TextStack                                                              | 仅参考导航中的 Upload 可发现性与导入成熟度           | 以 Gloaming 的内容层级重新表达                              | 不复制其产品结构或功能清单                                                   | 竞品不是 Gloaming 的设计 SSOT                                        |

## 15. Decisions Still Needed

本提案已按已锁定要求选定默认方向。进入实现前只需产品确认以下真实分歧：

1. **全局入口是否接受推荐的表现：** Desktop “上传 EPUB”次级文字按钮；Mobile 顶部 `+` 图标按钮。若希望移动端文字入口，应在可用宽度下评估其对 Theme/Account 的影响。
2. **上传成功后的确认方式：** 默认建议确认服务端已接收、说明作品将在 Library 整理，并提供可选“查看书库”；产品是否希望成功后自动跳转？本提案建议不自动跳转。
3. **失败恢复边界：** 当前 UI/API 对 Library 处理失败没有确认可用的单项重试/删除动作。若产品期望条目级重试，需要先确认后端能力和产品语义；在此之前不显示 Retry。

其余视觉区间属于设计建议，可在实现时通过运行时观察细调，不需要逐项重新决策。

## 16. Implementation Boundary

**本提案不执行实现。** 若方向确认，后续 UI 阶段预期涉及：

- **导航：** `apps/web/components/navigation/site-nav.tsx`、`nav-config.ts`、`apps/web/features/app-shell/app-shell.tsx`；添加跨页面 Upload 入口与共享 Dialog 宿主。
- **Library 页面与条目：** `apps/web/features/library/library-page.tsx`、`library-empty-state.tsx`、`library-continue-hero.tsx`、`library-grid.tsx`、`library-book-card.tsx`；调整信息层级、空状态与条目处理态。
- **上传体验：** 在 `apps/web/features/library/` 增加用户上传 Dialog 组合，复用 `library-api.ts` 的个人 EPUB 上传及校验能力；先确认可用的 Dialog primitive，不复用 Admin UI。
- **封面表达：** `apps/web/features/work-cover/work-cover.tsx`；无封面来源中性化并表达处理状态。
- **样式：** 优先使用 `apps/web/app/globals.css` 中已有语义变量和 Tailwind token；本方向不预设修改全局 token，也不改 `DESIGN.md`。只有确认现有 token 无法表达后，另行提出 Design SSOT 决策。
- **不在默认 UI 边界内：** 任何后端/共享 API 阶段状态、上传字节进度遥测、Library 数据模型或权限/删除/重试能力。若以后确需此类数据或动作，须单独定义产品契约并审查相应层级。

后续验收应区分静态代码检查与运行时视觉验证；本方向不能替代实际 Desktop/Mobile 和拖放状态的视觉验收。
