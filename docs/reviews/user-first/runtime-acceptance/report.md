# Gloaming — Runtime & Visual E2E Acceptance

日期：2026-10-10；环境：开发环境

## Current Acceptance Summary

截至 2026-10-10，当前验收结论如下。第 1–14 节（包括 Phase 1、Phase 2 及其后续检查中的旧状态）保留为修复前的历史快照；以本摘要和后续 closure section 为最新结论。

| E2E    | Latest status     | Notes                                                                                           |
| ------ | ----------------- | ----------------------------------------------------------------------------------------------- |
| E2E-01 | **CLOSED / PASS** | 章内位置恢复通过；初始落点仍有约 2.5 秒的可见跳动，单独记录为 P2 UX 观察项，不重新打开 E2E-01。 |
| E2E-05 | **CLOSED / PASS** | Personal Work 进入 Library 主网格和“我的上传”；已有管理能力可用。                               |
| E2E-06 | **Resolved**      | 随 E2E-05 下游解决；元数据编辑与标签关联入口可用。                                              |
| E2E-07 | **CLOSED / PASS** | 根因已修复，定向测试通过；中文与 English 内置浏览器复验均通过，刷新后状态一致。                 |

目前没有已知的 P0/P1 问题阻止 Personal EPUB 的基本阅读。历史报告中仍待处理、但本轮未复验的 P2 UX 项包括 E2E-02 首次加载空白、E2E-03 收藏筛选空态文案、E2E-04 Reader 控件可发现性，以及 E2E-01 的短暂初始落点跳动。AI、翻译、TTS 和 SourceRecord Discover 不属于本轮基本 Personal EPUB 阅读闭环的已验收范围。

## 1. Environment

| 项目                          | 结果                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                        | `dev-02`                                                                                                                                    |
| HEAD                          | `822e96b4d7cd327fe6bad870c6c054ef005910f7`                                                                                                  |
| Working Tree                  | 预先存在 3 个删除的 `pi-delegate` 文件和 `skills-lock.json` 修改；本次未改动这些文件                                                        |
| Frontend URL                  | `http://localhost:3000`                                                                                                                     |
| Backend URL                   | `http://localhost:3333`                                                                                                                     |
| Database migration head       | 开发库 `gloaming_backend` 已按授权迁移到 `0044`；本次未使用 `gloaming_test`                                                                 |
| Browser type                  | Codex 内置浏览器（IAB）                                                                                                                     |
| 是否为 Codex 内置可视化浏览器 | 是；页面通过可视化浏览器实际操作和截图检查                                                                                                  |
| 用户是否可见/可接管           | 是；当前 IAB 会话可由用户继续操作                                                                                                           |
| 服务启动状态                  | Backend、Worker、Web 均由本任务启动并保持运行；Backend 连接 PostgreSQL，Worker 连接 `gloaming` 与 `gloaming-asset-cleanup` 队列，Web 可访问 |
| 启动方式 / 端口               | `pnpm dev:backend` / 3333；`pnpm dev:worker` / 无 HTTP 端口；`pnpm dev:web` / 3000                                                          |

注意：`screenshots/` 目录已创建，但当前内置浏览器截图接口只把截图返回到交互界面，没有提供保存到本地路径的能力。因此本轮没有伪造或用其他浏览器工具生成截图文件。页面截图在本次浏览器交互记录中可见，文件导出仍待解决。

## 2. User Journey

| Step                   | Status          | Actual Result                                                                                                                                                                                           | Evidence                                                                         |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Anonymous Browse       | PASS            | 未登录首页正常渲染；Discover 可访问但为空态，无书目、搜索或详情入口。未登录进入 Library 会提示登录。                                                                                                    | IAB 首页与 Discover 页面；前序匿名会话检查                                       |
| Login                  | PASS            | 用户在内置浏览器完成登录；登录态持续有效，导航、Library、History、Settings、Account 均可访问。                                                                                                          | 顶栏账户菜单及各路由页面                                                         |
| Personal Upload        | BLOCKED         | 上传弹窗与文件类型/大小提示正常。文件选择器交互在 CUA 中超时，且一次返回了来源不确定的文件名；未提交任何上传。仓库安全测试夹具为 `apps/backend/tests/functional/domains/ingest/fixtures/pg11339.epub`。 | 上传弹窗；未提交文件                                                             |
| Library                | PASS            | 返回后展示“继续阅读”卡片和书籍列表；封面可见；来源与标签筛选可操作。首次进入时内容区域暂空且无加载提示，重新进入后内容出现。                                                                            | Library 页面；`/api/library` 返回 200                                            |
| Reader                 | PASS            | 现有作品正文可读，目录抽屉、章节切换可用；桌面与手机均能渲染长文本。                                                                                                                                    | Reader 页面、目录抽屉、章节 2 内容                                               |
| AI Assist              | BLOCKED         | Reader 有 AI 辅助入口；Settings 显示无个人 API 配置，默认服务可能产生费用。本轮未触发模型调用。                                                                                                         | Settings → AI                                                                    |
| Translate              | NOT_TESTED      | 翻译/双语入口存在；真实翻译需要触发 AI 请求，因可能计费未调用。                                                                                                                                         | Reader 双语控件；Settings → AI                                                   |
| TTS                    | BLOCKED         | Reader 有朗读入口；Settings 表明请求会使用默认服务，可能产生费用。本轮未请求音频，也未验证播放。                                                                                                        | Settings → 朗读                                                                  |
| Progress               | FAIL            | 阅读器切到第二章后，Library 与详情页显示 17% 且第二章标为“正在阅读”；Library 的“继续阅读”链接带有当前 part 并恢复到第二章。但从 Reading History 作品链接再次进入时 URL 无 part 参数，显示开篇内容。     | Library `?part=1a8c3285-e8e4-4de4-a335-7c9a8a10e2ac` 与 History 无参数入口的对照 |
| History                | PASS            | 阅读统计与作品记录可见；进入阅读器后，历史日期更新为当天。                                                                                                                                              | Reading History 页面；Backend `POST /api/reading-heartbeat` 返回 200             |
| SourceRecord Discover  | NOT_IMPLEMENTED | Discover 当前显示“暂时没有可发现的内容”。页面仍是旧 Catalog UI，未看到 SourceRecord 列表、搜索或 SourceRecord 详情流程。                                                                                | Discover 页面空态；前序只读源码检查                                              |
| Save Intent            | NOT_IMPLEMENTED | Discover UI 没有可保存的 SourceRecord 项目，无法在浏览器触发 Save Intent。后端已有 `POST /api/library/source-records/:sourceRecordId`。                                                                 | 页面无可操作条目；只读源码检查                                                   |
| Materialization        | NOT_TESTED      | 当前 Discover 无数据，不能从可见 UI 验证物化结果。未运行 Gutenberg 完整同步。                                                                                                                           | 无 UI 数据；未执行同步                                                           |
| SourceRecord → Library | NOT_IMPLEMENTED | UI 尚无 SourceRecord 保存入口，无法完成端到端路径。                                                                                                                                                     | Discover 页面；源码检查显示列表详情仍走旧 Catalog API                            |
| Library → Reader       | PASS            | Library 继续阅读链接打开现有作品当前章节；另一册未开始作品也提供 Reader 链接。                                                                                                                          | Library 页面与 Reader 页面                                                       |

## 3. UI / UX Findings

| 页面            | Desktop                            | Mobile                                          | Light | Dark   | 主要观察                                                                                                                | 截图状态                                   |
| --------------- | ---------------------------------- | ----------------------------------------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Home            | 1440：内容与首屏示例正常           | 390：标题折行、按钮与示例图适配；未见横向溢出   | PASS  | 未覆盖 | 登录状态首页截图中顶栏视觉上只看到“书库”，但可访问性树仍列出 Discover/History；需复核实际可见导航                       | 截图仅在本次 IAB 交互记录内                |
| Discover        | 1440：空态居中、留白充足           | 390：空态与底部导航可见                         | PASS  | PASS   | 空态说明清楚，但无可发现内容；SourceRecord UI 未接入                                                                    | 截图仅在本次 IAB 交互记录内                |
| Book Detail     | 已查看现有作品详情、目录、17% 进度 | 未专门复核                                      | PASS  | 未覆盖 | 显示继续阅读、阅读信息和章节状态；该作品标记为已在书库                                                                  | 截图仅在本次 IAB 交互记录内                |
| Library         | 1440：书籍封面与继续阅读可见       | 390：列表与底部导航可见                         | PASS  | 未覆盖 | 首次进入短暂空白且无 loading；重新进入后正常显示                                                                        | 截图仅在本次 IAB 交互记录内                |
| Reader          | 1440：正文列宽与长文本排版可读     | 390：长文本可读，目录面板可打开                 | PASS  | PASS   | Reader 顶部操作控件在截图中未呈现，尽管 AX 树可访问；需确认是否为有意自动隐藏。Next.js 开发角标遮住移动端底部最左导航项 | 截图仅在本次 IAB 交互记录内                |
| Reading History | 1440：统计、热图、作品记录可见     | 390：统计卡片、热图和作品列表适配；底部导航固定 | PASS  | 未覆盖 | 初始首屏也曾只显示标题，之后统计与列表加载出来                                                                          | 截图仅在本次 IAB 交互记录内                |
| Settings        | 1440：AI / 朗读标签可切换          | 390：设置卡片适配，底部导航可见                 | PASS  | 未覆盖 | AI 无个人 API 配置；朗读默认服务信息可见                                                                                | 截图仅在本次 IAB 交互记录内                |
| Account         | 已查看基本信息和设置区             | 未专门复核                                      | PASS  | 未覆盖 | 页面正常；本报告不复述账户邮箱等个人信息，也未修改凭证或邮箱                                                            | 未保存账户页截图以避免个人信息出现在证据中 |

主题与语言：浅色/深色切换均生效；简体中文/English 切换均生效。检查后已恢复为简体中文和浅色。手机尺寸检查后重置视口。

## 4. API / Runtime Findings

- Backend 日志中 `/api/auth/get-session`、`/api/library`、`POST /api/reading-heartbeat` 返回 200。
- Web 访问的首页、Discover、Library、Tags、History、Reader、Settings、Account 路由均返回 200。
- 本轮抽查的浏览器 Console 没有 warn/error。没有可用的内置 Network 面板 API，因此不能声称完整检查了所有请求。
- 未观察到 401、403、404、409、422、500、CORS 或请求失败。
- 后端请求日志中的 Cookie 已由日志输出层遮蔽；本报告不包含会话凭证或账户邮箱。
- Worker 启动并连接了两个队列；本轮没有触发需要 Worker 处理的新 EPUB 任务，因此未验收任务处理结果。

## 5. Issue List

### E2E-01 — Reading History 入口没有恢复最后章节

- **Severity:** P1
- **Category:** UX / Progress
- **Page:** Reading History → Reader
- **Reproduction Steps:** 在 Reader 切到第 2 章；回到 Reading History；点击该作品。再通过 Library 的“继续阅读”进入作为对照。
- **Expected:** 两个“继续阅读”入口都恢复已保存章节/位置。
- **Actual:** Library 路径带当前 `part` 并恢复第 2 章；History 作品链接不带 `part`，打开开篇内容。
- **Evidence:** History 链接 `localhost:3000/read/552334aa-9629-4bae-a24e-792a64af9fd2`；Library 链接带 `?part=1a8c3285-e8e4-4de4-a335-7c9a8a10e2ac`。
- **Suspected Cause:** 未确认；两个入口使用的目标 URL 不同。
- **Recommended Fix Direction:** 让 History 入口读取并传递保存的阅读位置，随后用真实用户流程复测。

### E2E-02 — Library 首次加载时空白且没有加载状态

- **Severity:** P2
- **Category:** UX
- **Page:** Library / Reading History
- **Reproduction Steps:** 登录后首次打开 Library 或 History。
- **Expected:** 数据加载期间显示清楚的 Loading 状态，或明确空状态。
- **Actual:** 首次观察时仅显示标题、主体空白；稍后重新进入后数据出现。未观察到错误提示。
- **Evidence:** 本次 IAB 的首次与后续页面状态对照。
- **Suspected Cause:** 未确认；可能是异步数据加载时没有占位态。
- **Recommended Fix Direction:** 检查加载期间的状态表达，并区分“正在加载”与“确实没有数据”。

### E2E-03 — 已收藏筛选空结果使用错误文案

- **Severity:** P2
- **Category:** UX
- **Page:** Library
- **Reproduction Steps:** 选择“已收藏”，且账户没有收藏项。
- **Expected:** 显示与收藏筛选一致的空状态文案。
- **Actual:** 显示“没有使用此标签的书籍”，与当前来源筛选无关。
- **Evidence:** Library 中选择“已收藏”后的 AX 状态。
- **Suspected Cause:** 未确认；可能复用了标签筛选的空状态文案。
- **Recommended Fix Direction:** 按当前筛选类型显示对应空状态说明。

### E2E-04 — Reader 操作栏在实际截图中不可见

- **Severity:** P2
- **Category:** UI / UX
- **Page:** Reader
- **Reproduction Steps:** 在 1440×900 与 390×844 打开 Reader 并查看初始视口。
- **Expected:** 阅读器目录、返回、双语、字体、AI 与朗读等主要控件可被用户发现。
- **Actual:** 实际截图只显示正文；AX 树存在这些控件，但视觉上未见操作栏。未确认是否需要点按正文显示控件。
- **Evidence:** 本次 IAB Reader 截图与对应 AX 树。
- **Suspected Cause:** 未确认；可能是自动隐藏或移动端专属布局行为。
- **Recommended Fix Direction:** 明确控件显示/唤出的交互，并确保首次进入时用户能发现主要操作。

## 6. Existing vs Missing

- **已实现且本轮真实验收通过：** 登录后主导航、Library 列表、标签创建/重命名、来源筛选切换、History 统计与作品记录、Library 继续阅读、Reader 正文与章节切换、主题和语言切换。
- **已实现但表现不一致：** History 作品入口不恢复当前章节；Library 初次加载的主体空白且无 Loading；筛选空态文案与来源筛选不符。
- **已实现但未能验收：** Personal EPUB 解析、Reader 内 AI 翻译/解释、实际 TTS 音频播放。
- **尚未实现于 UI：** SourceRecord Discover 列表、详情和 Save Intent 用户流程。只读源码检查到后端 SourceRecord list/detail 和 Save Intent 路由存在；Discover Web 仍调用旧 Catalog list/detail，且没有发现批量 Save Status 投影接口。

## 7. Top 5 Blocking Issues

1. **E2E-01（P1）：** Reading History 点击作品无法恢复上次章节。
2. **Personal EPUB 上传尚未验收：** 文件选择器未稳定选中指定仓库夹具；没有提交上传。
3. **SourceRecord Discover → Save Intent → Library 尚无可操作 UI。**
4. **AI/Translate 未实测：** 当前配置可能计费；等待用户批准一次小规模真实调用。
5. **TTS 未实测：** 默认服务可能计费；等待用户批准一次小规模真实调用。

## 8. Final Assessment

1. **当前项目能否正常启动？** 能。Backend、Worker、Web 均成功运行。
2. **当前 UI 整体能否正常访问？** 能。抽查路由均返回 200，主页面可实际操作。
3. **Personal EPUB 完整阅读链路是否真实跑通？** 没有。本轮未完成选择指定 EPUB，因此上传、解析、个人 EPUB 阅读与重进恢复均未验收。
4. **Gutenberg Discover → Save → Reader 是否真实跑通？** 没有。Discover 当前为空；SourceRecord UI 流程尚未接入。
5. **AI 是否真实可用？** 未确认。设置页没有个人 API 配置，本轮没有触发可能计费的请求。
6. **TTS 是否真实可用？** 未确认。本轮没有触发默认服务请求或音频播放。
7. **Reading Progress / History 是否正常？** 部分正常。Library Continue Reading 恢复当前章节且显示 17%；History 入口却打开开篇，存在路径不一致。
8. **是否存在数据权限问题？** 本轮未观察到权限错误；只验证了当前登录账户可见的数据，未尝试跨用户访问。
9. **是否存在严重 UI / UX 问题？** 未发现 P0；存在 P1 阅读历史位置恢复问题及若干 P2 加载/空态/控件可发现性问题。
10. **当前是否已经达到可供真实用户试用的 MVP 水平？** 暂不建议按完整阅读闭环验收通过；Personal EPUB、AI/TTS 与 SourceRecord Discover 仍有未验证或未接入部分。

## 9. Recommended Next Actions

1. 完成指定安全 EPUB 的上传与解析，再验收 Reader、进度保存和重进恢复。
2. 修正并复测 Reading History 的当前章节恢复。
3. 为 Library / History 的首屏异步加载补充明确 Loading 状态，并修正筛选空态文案。
4. 完成 SourceRecord Discover 与 Save Intent 的用户端接入后再跑该链路。
5. 由用户确认一次小规模 AI 和 TTS 默认服务调用是否可计费，再决定是否继续真实请求。

## 本轮统计

- 已检查 15 条流程：PASS 6、FAIL 1、BLOCKED 3、NOT_TESTED 2、NOT_IMPLEMENTED 3。
- 问题：P0 0、P1 1、P2 3。
- 未修改业务代码；未清理本轮创建的“E2E验收标签-已编辑”测试标签；未修改用户凭证或真实账户设置。
- 截图目录：`docs/reviews/user-first/runtime-acceptance/screenshots/`（当前没有导出的 PNG/JPG 文件；限制见 Environment）。

## 10. Phase 2 — Personal EPUB、位置恢复与补充界面验收

Phase 1 的统计与结论保留作历史快照；当前合并结论以本节和第 11 节为准。Phase 2 沿用原来的开发环境、登录会话和 Codex 内置浏览器，没有重新启动或停止服务，没有切换测试环境，也没有修改业务代码。用户启动的 Worker、Backend、Web 在验收期间保持运行。只上传了用户指定的仓库 EPUB 夹具；没有删除上传书籍或其他用户数据。

### Verification Matrix

| 场景                                | 状态                     | 观察结果 / 限制                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指定 EPUB 上传                      | PASS                     | 上传窗口显示 `pg11339.epub`、180.4 KB、格式正确；提交后显示“已加入书库，正在处理”。                                                                                                                                                             |
| Worker 解析并生成书籍               | PASS                     | 处理后书名识别为 _The Story of Miss Moppet_，作者为 Beatrix Potter，封面可见，Reader 可打开。未检查 Worker 日志；用户要求仅在出现错误时由其查看日志。                                                                                           |
| EPUB 正文、图片与目录               | PASS                     | Reader 显示正文和插图；目录识别为 1 章，章链接可打开。许可证/前言文本位于正文开头，章节内容仍可继续阅读。                                                                                                                                       |
| Reader 工具栏与字号                 | PASS / 观察项            | 首屏工具栏视觉上隐藏；点正文后工具栏出现。字号按钮可循环，验收后恢复“中”。没有发现页面内的唤出提示。                                                                                                                                            |
| Reader 滚动位置恢复                 | FAIL                     | 滚动到正文后返回书库，再从“继续阅读”进入，URL 带 part ID，但页面仍从 Gutenberg 前言顶部开始；书库进度仍为 0%。                                                                                                                                  |
| Reading History 记录                | PASS                     | 停留阅读后，新上传书出现在“读过的作品”中。                                                                                                                                                                                                      |
| History → Reader 位置恢复           | FAIL                     | 点击新 EPUB 的 History 记录后 URL 不带 part ID，Reader 回到电子书前言顶部。与 E2E-01 观察一致。                                                                                                                                                 |
| 上传书籍在 Library 列表中           | FAIL                     | _The Story of Miss Moppet_ 出现在“继续阅读”卡片，但没有出现在“全部书籍”卡片网格；切换“我的上传”后仍未显示该书。                                                                                                                                 |
| 上传书籍管理 / 编辑元数据           | NOT_IMPLEMENTED          | Reader 目录的书籍详情页只有“开始阅读 / 已在书库”、阅读信息和目录，没有编辑标题、作者、描述或标签的入口。未尝试改动其他书籍。                                                                                                                    |
| 上传书籍标签关联                    | BLOCKED                  | 新书不可从 Library 网格进入管理菜单，详情页也没有标签操作入口；因此未附加或移除标签。Phase 1 创建并重命名的 `E2E验收标签-已编辑` 保留。                                                                                                         |
| 深色 Library                        | PASS                     | 切换深色后书库内容与卡片可见，随后恢复浅色。                                                                                                                                                                                                    |
| Discovery / SourceRecord 数据库存量 | BLOCKED_BY_TOOL_ACCESS   | Discover UI 仍为空。浏览器对后端列表 URL 报 `ERR_BLOCKED_BY_CLIENT`，本机只读请求无法连接，Docker API 返回权限拒绝；没有运行同步、写库或猜测数据量。现有 SourceRecord UI 未实现的结论保持不变，实际 SourceRecord / DiscoverySource 行数未核实。 |
| Admin 页面                          | NOT_TESTED               | 当前账户菜单未显示 Admin 入口；没有确认账户角色，也没有尝试访问管理页。                                                                                                                                                                         |
| Phase 2 手机尺寸复测                | NOT_TESTED               | 本轮使用当前内置浏览器视口；可用的 CUA 接口没有视口尺寸覆盖操作，未切换到其他浏览器或自动化工具。保留 Phase 1 已记录的手机检查结果。                                                                                                            |
| AI / 翻译 / TTS 真实调用            | BLOCKED_BY_COST_APPROVAL | 未发起可能计费的模型或语音请求。                                                                                                                                                                                                                |

### Phase 2 新增 / 更新问题

#### E2E-01 — Reading History 入口没有恢复最后阅读位置（Phase 2 复测）

- **Severity:** P1（维持）
- **Phase 2 Evidence:** 新上传书滚动后，Library Continue URL 带 part ID，但 Reader 仍从前言开始；History 链接无 part ID，也从前言开始。书库显示 0%。
- **结果:** 问题复现；新 EPUB 的 1 章结构不能证明章内位置已保存或恢复。

#### E2E-05 — Personal EPUB 只出现在“继续阅读”，不在 Library 书籍网格

- **Severity:** P1
- **Category:** Personal EPUB / Library
- **Page:** Library
- **Reproduction Steps:** 上传 `pg11339.epub`，等待处理完成，查看“全部书籍”和“我的上传”。
- **Expected:** 上传对话框承诺将书加入书库；处理完成后应能在上传列表中找到并管理该书。
- **Actual:** 新书在“继续阅读”卡片出现，但书籍网格仍只有既有的 Aesop 与 Blunder 两项；选择“我的上传”也没有显示新书。详情页却显示“已在书库”。
- **Evidence:** Phase 2 Library 浅色与深色截图状态；AX 树中 Continue 有 Miss Moppet，全部书籍卡片没有该作品。
- **Suspected Cause:** 未确认；可能是 Personal Work、Library membership 与上传列表投影之间未连通。

#### E2E-06 — 新上传 EPUB 无可见元数据与标签管理入口

- **Severity:** P2
- **Category:** Personal EPUB / Library Management
- **Page:** Library → 书籍详情 / Reader 目录
- **Reproduction Steps:** 从 Reader 目录打开“查看书籍详情”，并在 Library 查找该新上传书的管理菜单。
- **Expected:** 若 Personal EPUB MVP 支持管理元数据与用户标签，应能对当前上传书进行编辑与标签关联。
- **Actual:** 详情页只提供阅读入口、阅读信息和目录；该书未出现在具有管理菜单的 Library 卡片网格。未能编辑标题/作者/描述，也未能添加后移除标签。
- **Evidence:** 详情页 AX 状态与 Library 卡片/管理菜单对照。
- **Status:** 本轮无法通过当前 UI 验收这些管理能力；不据此推断未展示的后台 API 行为。

### Screenshot Evidence Index

下列截图在 Phase 2 的内置浏览器交互中生成并显示；当前截图接口没有提供可保存路径，所以它们是交互记录中的证据标记，不是 `screenshots/` 中的导出图片。

| Capture ID | 页面状态                                                  |
| ---------- | --------------------------------------------------------- |
| P2-S01     | EPUB Reader 首屏：Gutenberg 前言、书名/作者与封面。       |
| P2-S02     | Reader 滚动正文：插图和段落；同页点击后工具栏出现。       |
| P2-S03     | Library 浅色：新书只在“继续阅读”出现，网格没有新书。      |
| P2-S04     | Library “我的上传”选中状态：新书仍未出现。                |
| P2-S05     | Library 深色：主题显示正常；之后恢复浅色。                |
| P2-S06     | Library 浅色恢复状态。                                    |
| P2-S07     | Reading History：新书已出现；点击后 Reader 回到前言顶部。 |

## 11. Combined Assessment After Phase 2

- **合并流程统计:** Phase 1 的 15 条检查 + Phase 2 Verification Matrix 的 15 条检查，共 30 条：PASS 12、FAIL 4、BLOCKED 6、NOT_TESTED 4、NOT_IMPLEMENTED 4。已确认问题共 P0 0、P1 2、P2 4；E2E-01 是 Phase 1 已有问题的复测，不重复计数。
- **Personal EPUB:** 指定 fixture 上传、解析、封面、正文与 Reader 可用；Library 网格/上传筛选呈现不完整，章内位置未恢复，标签与元数据管理没有可见入口。因此 **上传到阅读的窄链路通过，Personal EPUB MVP 整体未通过验收**。
- **Full User-first MVP:** SourceRecord Discover → Save → Library 仍没有可操作 UI；AI、翻译和 TTS 因潜在费用未调用；阅读位置恢复失败。因此 **Full User-first MVP 未通过验收**。
- **服务与数据:** Phase 2 没有启停服务；没有执行 Gutenberg 同步或数据库写入。用户指定上传产生的 Miss Moppet 测试书和 Phase 1 测试标签均保留。
- **源码 / 业务改动:** 没有修改业务代码；本报告追加了 Phase 2 观察结果。没有执行自动化测试或修复。
- **覆盖限制:** SourceRecord / DiscoverySource 数据库行数、Admin 页面、Phase 2 手机视口、AI/翻译/TTS 真实调用未覆盖，原因已在矩阵中逐项标注。

## 12. E2E-05 Closure

### Root Cause

开发库只读查询确认，当前登录用户拥有的 _The Story of Miss Moppet_ 是 `origin_kind=user_epub`、`visibility=private`、`processing_status=ready`，有一条阅读状态、没有 `user_library_item` membership。Library backend 的 owned-Work 查询按 `owner_user_id` 返回它，DTO 将其标为 `personal`；既有详情状态和当前页面的 Continue Reading 也与此一致。问题不在上传 ownership、Library API、Catalog membership、缓存、排序或 48 项上限。

前端 `apps/web/features/library/library-page.tsx` 原先在来源/标签过滤之前，按 `current.work.id` 从 `data.items` 删除 Continue Reading 的 Work。该书因此只显示在 Continue Reading Hero，All Books 与 My Upload 网格都无法提供其卡片管理菜单。此去重符合旧的前端体验基线，但与本轮“所有个人书籍必须能从 Library 主列表管理”的验收要求冲突；本轮保留 Hero，同时让这个 Library item 继续进入网格和正常筛选。

### Files Changed

- `apps/web/features/library/library-page.tsx`：不再从网格条目中移除与 Continue Reading 相同的 Work。
- `apps/web/features/library/library-page.spec.ts`：增加 current Work 同时属于 items 时的回归覆盖，检查 All Books、My Upload、Saved Catalog 排除、管理按钮和来源/标签筛选组合。

没有修改后端、数据库、ownership、Catalog membership、Reader、History、SourceRecord 或缓存失效逻辑。上传成功仍会失效 `libraryQueryKey.all`。

### Backend Behavior

- 当前开发库中的 Miss Moppet 属于已登录用户，状态为 private `user_epub` / ready；`user_library_item` 行数为 0，用户标签关联为 0（验收后恢复原状）。
- `apps/backend/tests/functional/domains/library/library.spec.ts` 覆盖 Personal Work 的 processing / ready / failed 投影、ready Personal Work 返回 `personal`、不可被伪造为 Saved Catalog，以及 Saved Catalog 显式加入后的正常行为。
- `apps/backend/tests/functional/domains/works/personal-epub-upload.spec.ts` 覆盖上传端点创建 owner-private Work 并返回 `uploaded`。

### Frontend Behavior

- All Books 现在同时保留 Continue Reading Hero 和对应的网格卡片，因此用户可以从卡片使用原有管理菜单。
- My Upload 显示 Miss Moppet；Saved Catalog 不包含它。Source 与 User Tag 过滤继续作用于完整 Library items。
- 上传成功后的 Library query invalidation 未改动；既有上传测试继续通过。

### Targeted Tests

- `cd apps/web && pnpm test features/library/library-page.spec.ts` — **13 passed**。新增 overlap 回归在旧去重逻辑下会失败。
- `pnpm --filter @gloaming/backend exec vitest run tests/functional/domains/library/library.spec.ts` — **3 passed**。
- `pnpm --filter @gloaming/backend exec vitest run tests/functional/domains/works/personal-epub-upload.spec.ts` — **5 passed**。
- `pnpm typecheck:web` — **passed**。
- `git diff --check` — **passed**。

后端功能测试使用 `apps/backend/.env.test` 中明确隔离的 `gloaming_test`；没有对开发库执行写入。

### Real Browser Result

使用当前已登录的 Codex 内置浏览器访问用户启动的 `http://localhost:3000/library`。未启动或停止任何服务，也没有切换环境。

- 刷新后 Miss Moppet 仍出现在 All Books 网格与 My Upload；切到 Saved Catalog 后不显示。
- 网格卡片上的“管理《The Story of Miss Moppet》”菜单出现，包含“管理标签”和“编辑书籍信息”。
- 编辑面板保存临时书名成功，随后恢复为原书名 _The Story of Miss Moppet_；作者仍是 Beatrix Potter。
- 关联现有 `E2E验收标签-已编辑` 后可用该标签筛出 Miss Moppet；取消关联后标签筛选不再显示它。只读复查确认没有遗留标签关联，也没有 Catalog membership。
- 从网格卡片打开 Reader 成功；正文和插图可见。
- 浏览器截图显示 Continue Reading 与 All Books 网格同时呈现 Miss Moppet。截图作为本轮内置浏览器交互证据显示，截图接口不提供可保存文件路径。

### Status

- **E2E-05: CLOSED / PASS.** 根因已由数据库只读结果、现有后端投影测试、源代码和真实浏览器页面共同确认；最小前端修复通过定向测试与运行态复验。
- **E2E-06: Resolved as downstream effect of E2E-05.** 网格管理入口出现，元数据编辑和标签关联均通过真实页面完成并恢复测试数据原状；没有另建管理界面。

### Remaining Risks

- Continue Reading 和 All Books 现在会同时呈现同一本进行中作品。这是保留现有 Hero、同时满足主列表管理能力的直接结果；与旧体验基线中去重的描述不同。
- Library 仍有 48 条响应上限，来源/标签筛选仍在客户端；超过该总上限时分类结果可能不完整。这与本次只有 3 条 Library item 的复现无关，未在本轮扩展为分页工作。
- 本轮没有复测移动端布局；未运行全量测试、全量构建或 Gutenberg benchmark。

## 13. E2E-01 Closure

### Root Cause

The Phase 2 observation conflated chapter restoration with within-chapter scroll restoration. The History link omits `part`, but Reader fetches the user's Reading State and resolves the current valid `currentPartId` when the URL has no valid `part`; this works in the current browser. The reproducible limitation is that no within-chapter location is written or restored. Scrolling therefore returns to the top of the saved part after leaving or refreshing.

### Progress SSOT

`reading_state` is the single persisted source for a user's current part, completed-through sort order, status, revision, and timestamps. `progressRatio` is computed from state and the Work's parts; it is not persisted. Reader heartbeat is a separate engaged-time path to `reading_day` and does not save reading position. No competing persistent position source was found.

The database retains `anchor_kind` and `anchor_value`. As of the approved E2E-01 decision (below), the runtime reuses those existing columns for a within-chapter scroll anchor, so no schema or state model was added. `completed_through_sort_order` remains the chapter-progress field, and `progressRatio` remains chapter-completion based; the anchor never feeds progress.

### Chapter Restore

PASS in the current development browser. Aesop's Fables has 10 parts. After advancing to part 3, Library Continue opened the same part with a `?part=` URL. The History link had no `part` parameter, yet Reader reopened part 3 from Reading State. Reloading that History URL also reopened part 3.

### Intra-chapter Restore (approved E2E-01 decision, implemented)

The pre-decision observation was NOT SUPPORTED: Aesop was scrolled near the end of part 3; History re-entry and browser refresh both returned to the top of part 3, and Miss Moppet behaved the same for its sole part.

**Approved product decision (this task):** restore the reader's last scroll position within the current chapter after leaving, re-entering, or refreshing. Progress percentage stays based solely on completed chapters and is not affected by scroll. No new schema/table/state model; `reading_state.anchor_kind` / `anchor_value` are reused only with a safe `current_part_id` pairing.

**Implemented choice:** the anchor is `anchor_kind = 'part_ratio'` and `anchor_value = JSON.stringify({ partId, ratio })`, where `ratio` is `scrollTop / (scrollHeight - clientHeight)` clamped to `[0, 1]`. The part id is stored _inside_ the anchor and the backend mapper emits the anchor only when that stored `partId` equals the row's `current_part_id`; a mismatched or malformed anchor is treated as absent. A new `save_position` action writes only these two columns for the part that is still current. Explicit chapter changes (`navigate`, `complete_chapter`, `restart`, and an `open` that actually switches parts) clear the anchor, so an old chapter's position can never be applied to a new chapter. Reader entry from Library and History (including a History URL with no `?part`) resolves the current chapter from Reading State and then restores that chapter's saved ratio.

**Write policy:** scroll saves are throttled (`2s`) with a minimum ratio delta (`0.02`). A single ref-driven keepalive flush reads the live scroll-container ratio (falling back to the trailing scheduled ratio) and runs on `visibilitychange` (hidden), `pagehide`, and Reader unmount; it re-sends even when the most recent write was an immediate non-keepalive save, so an in-flight request that unload aborts is not lost. Chapter navigation (`navigate`, `complete_chapter`) and finish await that flush for the outgoing chapter before issuing the state command, so resetting the throttle state on the `activePartId` change cannot discard a recent trailing position; the live ratio is always paired with the still-current part, and duplicate lifecycle flushes of the same ratio are skipped. The `save_position` write intentionally does not bump `revision`, so it never invalidates another client's chapter-navigation CAS revision or raises a conflict toast; the mapper's `partId` pairing and the update's `revision =` predicate together make a write that lost a race to a chapter change a silent no-op.

### Percent Calculation

`computeChapterProgress` calculates completed parts divided by total parts, rounded to an integer; an explicitly completed Work is 100%. Opening or scrolling through a part does not complete it. A one-part Work therefore remains 0% while `in_progress`; its Reader exposes the explicit finish action, which changes the state to `completed` and yields 100%. Aesop reached 20% after completing the first two of 10 parts and remained 20% after scrolling in part 3 and waiting 31 seconds. Miss Moppet remained 0% after scrolling and waiting 31 seconds. These results match the current calculation.

### Library Entry

Library Continue is `/read/{workId}?part={currentPartId}` when a current part exists. The live Library projection showed Aesop at 20% and linked to part 3. Opening that entry restored part 3. A Personal single-part Miss Moppet remained at 0% while in progress.

### History Entry

History work links are `/read/{workId}` without a `part` query. The Reader resolves `currentPartId` from Reading State and, with the E2E-01 implementation, also restores that part's saved within-chapter ratio. Pre-decision browser evidence showed only the chapter restore; the within-chapter part awaits the Supervisor's independent visible IAB verification.

### Single-chapter EPUB

_The Story of Miss Moppet_ has one part. Its current status remained in progress and its displayed ratio remained 0% after scrolling and waiting. This is expected from the completed-part formula; the explicit finish action is the only normal path to 100%. The E2E-01 decision keeps scrolling out of the ratio; a single-part Work can now restore its scroll position while still showing 0% until the reader finishes it.

### Multi-chapter EPUB

The existing _Aesop's Fables; a new translation_ has 10 parts. Reader navigation moved from part 1 to part 2 and then part 3; the current part and 20% ratio survived Library, History, and browser refresh. Scrolling in part 3 does not change the ratio; the E2E-01 implementation now saves and restores that scroll position.

### Automated Tests

Pre-decision run covered the chapter/CAS/History baseline. Post-implementation targeted run:

- `packages/shared/src/reader/reader.spec.ts` — **15 passed** (adds `save_position` contract, anchor pairing validation, and legacy-optional `anchor`).
- `apps/web/features/reader/reader-model.spec.ts`, `apps/web/features/reader/reader-state-command.spec.ts`, and `apps/web/features/reading-state/reading-state-api.spec.ts` — **25 passed** (scroll-ratio math, part-paired restore, throttle gate, lifecycle flush ratio selection, and anchor projection into the reader view model).
- `apps/backend/tests/functional/domains/reading/reader.spec.ts` — **2 passed** and `apps/backend/tests/functional/domains/reading/reading-history.spec.ts` — **4 passed** on the explicitly configured `gloaming_test` database. The new backend case covers anchor persistence for the current part, ignoring a write for a non-current part, surviving a re-open of the same part, no revision bump, and clearing on chapter change; it also keeps the pre-existing chapter-progress, finish/restart, and CAS assertions.
- These tests do not cover the complete browser journey. The backend test run repeatedly logged rejected verification-email submissions from the configured mail provider (unrelated background mail), but all assertions passed.

### Browser Verification

Pre-decision observations above remain historical. The post-implementation visible IAB re-verification was performed on 2026-10-10 in the existing logged-in browser session at the user's development services. No service was started, stopped, or restarted. No Playwright, Puppeteer, Selenium, CDP, or local Chrome automation was used.

#### Runtime Re-verification

- **Runtime Failure Root Cause:** The prior “无法加载书库 / 请求失败” condition did not reproduce during this verification. The logged-in Library page loaded its user-specific contents and displayed both target works; this confirms the browser's authenticated Library request was succeeding, not an anonymous command-line `401`. A precise cause for the earlier transient failure could not be established. Shell HTTP probes could not reach either localhost service from this execution environment (the default proxy and direct loopback attempts both failed), so those unauthenticated probes provide no evidence about the browser session. The Codex thread has no attached app terminal, and the browser-control surface did not expose console or server logs; readiness/DB health could not be independently read through those paths. No credentials or cookies were inspected or emitted.
- **Services Changed:** None. Read-only listener inspection found Web PID `18774` rooted at `apps/web` on port `3000`, and Backend PID `32533` rooted at `apps/backend` on port `3333`. Both remained untouched. No TCP listener was found for a Worker in the inspected listener list; its process state was not independently established. No database query or write was performed.
- **Library Recovered:** Yes. The current authenticated Library page rendered 3 works and a Continue Reading card. Aesop and Miss Moppet were present. The previous request-failed page was not visible after the page had recovered.
- **Single-chapter Restore:** **FAIL.** Miss Moppet's only part was restored, but the scroll anchor drifted materially. After scrolling into the illustrated story, the Library re-entry landed near the story ending; the History re-entry landed farther into the Project Gutenberg license; refresh moved farther again. This is not close to the user's prior reading location. The images themselves loaded, but the visible landing location varied across reload/navigation paths.
- **Multi-chapter Restore:** **PASS.** Aesop's Fables opened at part 3/10. Library re-entry, History re-entry (whose URL omitted `part`), and refresh all restored part 3 and a visually similar middle-of-part position. The first return and reload did not show stale chapter content or a conflicting-state message.
- **History Restore:** Aesop **PASS** for chapter and approximate scroll position. Miss Moppet **FAIL** for scroll proximity as described above; its one-part chapter identity stayed correct.
- **Refresh Restore:** Aesop **PASS** for chapter and approximate scroll position. Miss Moppet **FAIL** for scroll proximity; it remained in the sole part but landed progressively farther into the appended license text across re-entry and refresh.
- **Rapid Exit:** **PASS** in the exercised paths. Aesop was scrolled and immediately returned; the next History entry reflected the later location. Miss Moppet was rapidly scrolled back to the story opening, immediately left, then reopened from History near that same story-opening region. These checks do not negate the route-dependent drift seen on ordinary Miss Moppet re-entry.
- **Chapter Switch:** **PASS.** Aesop moved from part 3 to part 4 (`THE ASS IN THE LION'S SKIN`, 4/10), then was immediately exited and reopened from History at part 4 near its start. No old-part position was applied and no conflict/error state appeared.
- **Progress Regression:** No percentage regression observed. Aesop showed 30% after moving to part 4, consistent with three of ten chapters completed; scrolling did not alter the percentage. Miss Moppet remained 0% while in progress, consistent with the completed-chapter formula for a one-part work. A separate presentation mismatch was visible: Miss Moppet showed “阅读中” in Continue Reading and “正在阅读” in History, while its Library grid card said “未开始”.
- **Remaining Issues:** Miss Moppet's persisted scroll-ratio restore is not visually stable across Library, History, and refresh; this leaves E2E-01 failed. The current UI also disagrees on Miss Moppet's in-progress status label. The initial Library request failure's exact cause and current Backend readiness/database health were not independently confirmed because shell localhost access and app/server logs were unavailable in this execution context. No restart is indicated by the successfully loaded authenticated Library/Reader paths.

**E2E-01 runtime result: FAIL / NOT CLOSED.** Multi-chapter chapter/position restore, rapid exit, chapter switching, and progress percentages passed. Single-chapter scroll proximity and Library status-label consistency remain failing observations. No source code was changed during this runtime verification.

### Files Changed

- `packages/shared/src/reader/reader.ts`, `packages/shared/src/reader/index.ts`, `packages/shared/src/reader/reader.spec.ts` — `save_position` action, `ReadingAnchor` contract, optional `anchor` on `ReadingState`.
- `apps/backend/src/domains/reading/reader/reading-state.ts` — decode/emit the anchor only when paired with `current_part_id`.
- `apps/backend/src/domains/reading/reader/state-mutations.ts` — `save_position` handling, anchor clearing on chapter change, no `reading_day` touch for position writes.
- `apps/backend/tests/functional/domains/reading/reader.spec.ts` — anchor persistence/reset/pairing coverage.
- `apps/web/features/reading-state/reading-state-api.ts` — `saveReadingAnchor` keepalive-capable position write.
- `apps/web/lib/api-request.ts` — optional `keepalive` transport flag.
- `apps/web/features/reader/reader-model.ts`, `apps/web/features/reader/reader-api.ts`, `apps/web/features/reader/reader-page.tsx` — anchor projection, throttled save, part-paired restore.
- `apps/web/features/reader/reader-model.spec.ts`, `apps/web/features/reader/reader-state-command.spec.ts` — web anchor behavior coverage.
- `docs/reviews/user-first/runtime-acceptance/report.md` — this closure record.

No database schema or migration was changed.

### Remaining Limitations

- **E2E-01 is not closed.** The authenticated IAB runtime is currently usable, but Miss Moppet's scroll-ratio landing drifted materially between Library, History, and refresh. The pre-decision observations above remain historical evidence.
- The anchor is a scroll ratio, not a text/paragraph anchor. Reflow can change the visible semantic location at the same ratio; the Miss Moppet run exposed a larger-than-acceptable difference. This report records the failure without changing code.
- ADR-001 lists `anchor_kind` / `anchor_value` as ReadingState key fields without defining their semantics. This task gives them the `part_ratio` meaning in code; the ADR wording should be reconciled separately.
- No schema change, auto-completion behavior, alternative progress model, or change to ownership/Library membership/History/AI/TTS was introduced. `progressRatio` remains completed-chapters divided by total parts.

## 14. E2E-01 Stabilization

### Root Cause

The Reader restored a `part_ratio` anchor against a scroll range that was still changing as content and typography settled. The same ratio could therefore map to a different visible paragraph. A second write path made that transient position persistable: the lifecycle flush could read the live scroll position while restoration was still in progress, even though ordinary scroll saves already suppressed programmatic movement. This allowed a provisional restore position to replace the intended anchor and explained the observed repeated drift toward the appended Gutenberg license.

The code and browser evidence support this timing/write-boundary diagnosis. The browser run did not collect numeric `scrollHeight`, ratio, image-load, or font-load traces, so it does not establish whether images or fonts individually caused a particular layout shift.

### Evidence

- Before the change, the restore effect ran immediately and once on the next animation frame without waiting for content layout to stabilize. Reader content contains inline EPUB images; their natural dimensions and font completion can change the scroll range after that point.
- Before the change, the `pagehide` / unmount flush read the live scroll ratio without honoring the restore quiet window. A wrong intermediate ratio could consequently become the next persisted anchor.
- The regression tests now exercise bounded layout reapplication, restore-pending save suppression, cancellation on genuine user scroll intent, lifecycle cleanup/replay behavior, and repeated restores using the existing ratio contract.
- In the current IAB run, repeated Miss Moppet Library, History, and refresh restores settled on the same recognizable illustrated passage rather than advancing toward the license. Aesop remained at the same part and reading region across the same entry paths.

### Anchor Before

The visual test target was the illustrated passage “Miss Moppet looks worse and worse. The Mouse comes a little nearer.” The reader waited approximately 2.2 seconds after scrolling before leaving. The exact persisted ratio was not exposed by the UI and was not independently queried from the database.

### Anchor After

The saved `part_ratio` contract and its part pairing are unchanged. After stabilization and re-entry, the target paragraph and adjacent illustrations remained in the viewport in each observed Miss Moppet restore. No numeric before/after ratio was read; the browser comparison is visual and semantic.

### Layout Behavior

Content-height changes during the restore window trigger another application of the same saved ratio. The stabilization is bounded and observes content/layout events rather than relying on a fixed one-second delay. Browser verification saw a transient initial position closer to the appended license on some mounts; after roughly 2.5 seconds, the viewport settled back around the target illustration and paragraph. This temporary movement did not accumulate across the repeated rounds. The test did not attribute a particular shift to a specific image or font event.

### Restore Timing

Restore begins after the current part and persisted anchor are available. It remains pending during the bounded layout-stabilization window, reapplies the ratio when the observed scroll range changes, and then settles. Library and History both resolve to the same Reading State part; History's URL omits `part`, while Library carries it. Refresh follows the same resulting part/anchor restore behavior.

### Scroll Write Behavior

Programmatic restoration is not treated as reader intent. Scroll saves and lifecycle flushes are suppressed while restoration is pending. Genuine wheel, touch, and keyboard scroll intent takes ownership and cancels the pending restore; a subsequent user-driven position may then be saved. Cleanup releases an in-flight marker for the same part so React effect replay can restore safely. The persisted anchor remains paired with its part; no second persisted location source was added.

### Fix

The Reader now uses a bounded, event-driven layout-stabilization window with `ResizeObserver`, image `load`, and font readiness signals, reapplying the existing ratio when the scroll range changes. Restore state is ephemeral and gates programmatic scroll writes and lifecycle flushes until settled or cancelled by real user scrolling. The chapter/anchor data contract, `reading_state`, `anchor_kind`, `anchor_value`, and `part_ratio` remain intact.

### Tests

- Reader targeted tests: **7 test files, 55 tests passed**.
- Web typecheck: **passed**.
- ESLint on `reader-page.tsx`, `reader-model.ts`, and `reader-model.spec.ts`: **passed** (the existing `no-html-link-for-pages` setup warning remains informational).
- Prettier check for the three Reader files: **passed**.
- `git diff --check`: **passed**.
- No Backend or Shared files were changed by this stabilization, so their typechecks and tests were not rerun. No database writes or schema changes were made.

### Miss Moppet 3-round Result

**PASS after stabilization.** Three repeated visual cycles used the illustrated passage as the target. Across the cycles, Library re-entry was checked three times; History re-entry and refresh were also checked. Each restore remained in the sole part and settled around the same target passage. The first frame could be temporarily displaced toward the license before layout stabilization completed, but the final observed position returned to the target area within approximately 2.5 seconds. No monotonic drift toward the book's end was observed. The single-part progress display remained 0%, consistent with chapter-completion progress.

### Aesop Regression

**PASS.** Aesop restored at `THE ASS IN THE LION'S SKIN`, part 4/10, with the same visible fable region after Library entry, History entry, and refresh. A rapid down/up scroll followed by immediate exit and History re-entry retained part 4 and its saved reading region. Switching to `THE OX AND THE FROG`, part 5/10, then immediately exiting and re-entering restored part 5 at its beginning; the previous chapter's position did not leak into it. Library continued to display 30% while on part 4, with no scroll-related percentage regression observed.

### Browser Verification

Used the current authenticated Codex in-app browser against the user's already-running development services. No service was started, stopped, or restarted. No Playwright, Puppeteer, Selenium, CDP, or local browser automation was used. Reader UI showed no error or conflict state during these paths.

### E2E-07 — Reading Status Label Consistency (pre-fix historical observation)

At the time of this E2E-01 verification, Miss Moppet's Continue Reading section said “阅读中” and Reading History said “正在阅读”, while its grid card said “未开始” at 0%. This historical observation is superseded by Section 15.

### Remaining Risks

- The first visible frame can be temporarily displaced before the layout-stabilization pass completes. The final target was consistent in this run, but the intermediate movement is still visible for up to roughly 2.5 seconds on the tested local runtime.
- Browser validation was visual; numeric anchor values and scroll metrics were not collected. The automated regression suite covers the save/restore boundaries, but cannot reproduce every browser-specific font or image layout behavior.
- The GitNexus index was 26 commits behind `HEAD`; impact review therefore relied on source/call-site inspection and targeted tests rather than a current graph index.
- E2E-07 was open at the time of this snapshot; its current fix and partial browser result are recorded in Section 15.

**E2E-01: CLOSED / PASS.** Across three repeated single-chapter visual cycles, Library, History, and refresh re-entry were exercised and the restored position remained near the same illustrated passage; the multi-chapter regression paths also passed. This result records the settled visual position; transient first-frame movement and the separate E2E-07 display issue remain documented.

## 15. E2E-07 Closure

### Root Cause

`LibraryBookCard` derived its status label from `progressRatio`: it mapped `in_progress` with a zero ratio to “未开始”, and a positive ratio to a percentage status label. For the single-chapter _The Story of Miss Moppet_, `in_progress` with 0% is valid under the existing completed-chapter progress formula. The card therefore contradicted the actual Reading State and the Continue Reading / History surfaces.

### Fix and Files Changed

- `apps/web/features/library/library-book-card.tsx`: visible card status now follows Reading State. An absent state remains “未开始”; `completed` uses the existing completed copy; `in_progress` uses the existing “阅读中” copy regardless of ratio. The percentage remains a separate progress indicator.
- `apps/web/features/library/library-page.spec.ts`: covers absent state/0%, `in_progress`/0%, `in_progress`/40%, completed/100%, and Continue Reading plus grid status consistency.
- `apps/web/features/history/history-works.spec.ts`: renders the actual History component and covers `in_progress` → “正在阅读” and `completed` → “已读完”. This confirms the same Reading State semantics while retaining the existing surface-specific copy.

No progress formula, Reading State persistence, schema, database, backend, shared contract, or other domain was changed. The project status enum has `in_progress | completed`; absence of Reading State is its existing not-started representation, so no synthetic `not_started` enum value was introduced.

### Tests

- `pnpm --filter @gloaming/web exec vitest run features/history features/library` — **5 files, 27 tests passed**.
- `pnpm --filter @gloaming/web typecheck` — **passed**.
- ESLint for the three changed Web files — **passed**.
- Prettier check for the three changed Web files — **passed**.
- `git diff --check` — **passed**.
- The new Library regression assertion failed against the old zero-ratio status branch (`expected '未开始' to be '阅读中'`), then passed after the fix was restored.

### Browser Result

Using the existing authenticated Codex in-app browser and already-running development services:

- **Library Continue:** Miss Moppet shows “阅读中”; its progress display remains 0%.
- **Library Grid:** the Miss Moppet card shows “阅读中”.
- **Reading History:** Miss Moppet shows “正在阅读”.
- **Refresh:** after refreshing Library, Continue and grid still show “阅读中” at 0%.
- **English:** the user switched the existing signed-in browser locale to English. Library Continue and the grid card both show “Reading” while the separate progress display remains “0% read”; Reading History also shows “Reading”. After refreshing both History and Library, the same labels and 0% progress remained visible.

### Status and Remaining Issues

**E2E-07: CLOSED / PASS.** Chinese verification showed Library Continue “阅读中”, Grid “阅读中”, History “正在阅读”, and the same after Library refresh. English verification showed Continue “Reading”, Grid “Reading”, History “Reading”, and those labels remained after History and Library refresh. In both locales, Miss Moppet remains at 0% under the existing completed-chapter progress formula.

**E2E-01: CLOSED / PASS.** Its separate P2 observation remains: the initial restored viewport can visibly move for approximately 2.5 seconds before settling. This does not reopen the position-restoration issue.
