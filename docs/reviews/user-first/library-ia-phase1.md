# Library IA Phase 1 验收记录

日期：2026-10-10
分支：`dev-02`
阶段：IA-01 与 IA-02 实现及验收

## IA-01：Reading State 状态文案

- 根因：详情页根据 `progressRatio > 0` 推断 `in_progress`；因此 `in_progress + 0%` 被映射成未开始。
- 修复：详情页的开始、继续、再次阅读状态现在只由 ReadingState 状态决定。阅读进度百分比公式和数据库状态未改。
- 影响：详情页、目录章节状态和主阅读入口；0% 的进行中作品显示“继续阅读”。
- 自动化：Web 测试套件 42 个文件、231 项通过；新增零进度状态回归断言。
- 浏览器：PASS。真实 Library 页面中，Miss Moppet 的 `in_progress + 0%` 在 Continue Reading 与书籍卡片均显示“阅读中”；英文界面均显示 `Reading`，0% 单独显示为 `已读 0% / 0% read`。书名进入 Work Detail，明确的继续阅读操作进入 Reader。

## IA-02：统一 Work Detail 与返回导航

- 规范路由：`/works/[workId]`，使用现有 Book Detail Feature。
- 旧路由：`/discover/[workId]` 作为兼容入口，重定向到规范路由；只保留 allow-list 内的站内返回目标。
- 返回目标：Library、Discover、Reading History、同一 Work 的 Reader；缺失或非法值回退到 Library。Reader 来源保留 `part` 查询，由既有 ReadingState 恢复章内位置。
- Library：封面/书名进入详情；就地阅读操作仍直接进 Reader；Continue Reading 仍直接进入 Reader。Processing/failed 不展示 Reader 操作，封面/书名可进入状态详情。
- History：封面/书名进入详情；独立阅读按钮直接进入 Reader；历史统计及状态数据语义未改。
- Reader：复用目录中现有书籍详情入口，返回目标携带当前 Work 和 Part URL。
- Personal Work：详情从当前用户的 Library Item 与既有 Reader Parts API 组装；复用个人元数据编辑、标签关联、删除能力。未通过 Catalog 接口伪造 Personal Work，也未修改权限或数据模型。
- Catalog：保存的书仍使用现有加入/移出书库及标签管理；无个人编辑和删除入口。
- 自动化：返回地址 allow-list、旧路由重定向 URL、Library/History 路由形状和已有管理菜单回归包含在 Web 测试中。
- 权限证据：沿用既有 Catalog 和 Reader Work Access 路由；Personal detail 只从已认证用户自己的 `/api/library` 条目加载。真实私有权限页面验收待浏览器接续。
- 浏览器：PARTIAL。Library → Work Detail、History → Work Detail、Reader 目录 → Work Detail 均实际通过内置浏览器验证；返回入口分别回到 Library、History、原 Reader Work 与同一 Part。详情刷新后内容及 History 返回目标保留。旧 `/discover/[workId]` 路由未能通过浏览器直接打开验证；自动化路由测试覆盖重定向。直接地址打开、1440px 和 390px 视口、私有 Work 越权访问及已收藏 Catalog Work 的真实数据路径仍未完成。
- 详情管理：Miss Moppet 的个人管理菜单可打开；“编辑书籍信息”显示可用字段，标签管理面板可打开。没有保存变更。当前书库中的 Peter Rabbit 也被“我的上传”筛选返回；当前会话没有可用于真实验收的 Saved Catalog Work，因此不据此推断 Catalog 权限验收通过。

## 检查结果

- `pnpm --filter @gloaming/web test`：通过，42 个测试文件 / 231 项。
- `pnpm typecheck:web`：通过。
- `pnpm typecheck:i18n`：通过。
- 改动文件 ESLint：通过。
- `git diff --check`：通过。

## 未完成 / 限制

- 浏览器验收不完整：通过界面菜单检查了中英文与浅色/深色主题；深色详情截图显示封面、标题、作者、继续阅读和章节目录层级正常。视口大小未能控制到指定的 1440px / 390px；旧路由直接导航被内置浏览器安全策略拒绝，未尝试绕过。没有找到可用于 Saved Catalog Work 与私有访问边界真实验收的数据。
- Browser runtime 实际已加载 Library、History、Reader 和 Work Detail，足以确认这些页面可以调用当前登录会话的服务；早先 shell 对 localhost 的请求受工具网络策略阻挡，不能据此判定 Backend 故障。未重启 Backend 或 Worker。
- Library 当前筛选状态保存在页面本地状态而非 URL，因此由详情返回时只能回到 Library；查询参数可以保留，筛选状态完整恢复仍属于后续 IA-03。
- 没有执行数据库迁移、Gutenberg 同步、AI/TTS、提交或 Push。

## IA-02 Navigation Closure — 2026-10-10

### Navigation Root Cause

- Reproduction: The reported Reader → Work Detail → Back → Discover failure was not reproduced in the current `dev-02` working tree. The actual user path returned to the same Reader and part in repeated browser runs.
- Root cause: Not confirmed. The current Reader TOC creates a canonical Work Detail link with a same-Work Reader `returnTo` URL including `part`; the Work Detail route resolves that allow-listed URL and its in-app return link uses it. The legacy Discover route forwards the validated return target. No evidence supports changing these paths or claiming that the reported failure is fixed.
- Related fallback observed in source: the Reader’s own Back control uses browser history when available and falls back to Discover only when history has no prior entry. This is distinct from the Work Detail return control and was not proven to cause the report.
- Code fix: None. No business code was changed because the claimed failure could not be reproduced and no causal defect was established.

### Navigation Verification

- Library → Detail → Library: PASS. `/library` → `/works/30e95516-257d-4562-97b0-a1e5cf74197c?returnTo=%2Flibrary` → `/library`.
- History → Detail → History: PASS. `/reading-history` → `/works/30e95516-257d-4562-97b0-a1e5cf74197c?returnTo=%2Freading-history` → `/reading-history`.
- Reader → Detail → Reader: PASS. `/read/30e95516-257d-4562-97b0-a1e5cf74197c?part=2b19b74a-78d5-478d-9dfd-902d754c89f4` → `/works/30e95516-257d-4562-97b0-a1e5cf74197c?returnTo=%2Fread%2F30e95516-257d-4562-97b0-a1e5cf74197c%3Fpart%3D2b19b74a-78d5-478d-9dfd-902d754c89f4` → the same Reader URL.
- Reader Position: PASS for the visible Miss Moppet path. The page was scrolled to the illustration and adjacent paragraph; returning from Work Detail, including after a Detail refresh, restored the same `part` and recognizable content area. This browser check does not instrument backend writes, so it cannot independently prove that no anchor flush occurred during Reader unmount.
- Browser Back: PASS when invoked on Work Detail; it returned to the preceding Reader URL. This is separate from the Work Detail’s visible return link.
- Direct Detail: PASS. `/works/30e95516-257d-4562-97b0-a1e5cf74197c` showed the work and a Library fallback link.
- Refresh: PASS for Detail with a valid Reader `returnTo`; after refresh, the visible return link still targeted the same Reader `part`.
- Legacy Route: PASS in the current browser. `/discover/30e95516-257d-4562-97b0-a1e5cf74197c?returnTo=<encoded Reader URL>` redirected to the canonical `/works/...` URL and retained the encoded Reader target.
- Invalid returnTo: PASS in the current browser. An external `https://evil.example` target was rejected; the visible return link targeted `/library`.
- Reader CTA: PASS. Work Detail’s “继续阅读” opened the same Reader `part`.

### Tests

- `pnpm --filter @gloaming/web test -- apps/web/features/book-detail/book-detail-model.spec.ts apps/web/features/reader/reader-model.spec.ts apps/web/features/library/library-page.spec.ts apps/web/features/history/history-works.spec.ts` completed the Web suite: 42 files and 231 tests passed. This includes Book Detail return helper, Reader anchor, Library, History, IA-01 state, and E2E-05 grid coverage.
- `pnpm typecheck:web`: PASS.
- `pnpm lint:web`: PASS.
- `pnpm exec prettier --check docs/reviews/user-first/library-ia-phase1.md`: PASS.
- `git diff --check`: PASS for tracked changes. The updated report is untracked in the preexisting dirty tree; Prettier check passed for the report.

### Browser Evidence

- Actual flow: Library → Miss Moppet Detail → Continue Reading → Reader → TOC → Work Detail → visible “回到阅读器”.
- Entry URL: `/read/30e95516-257d-4562-97b0-a1e5cf74197c?part=2b19b74a-78d5-478d-9dfd-902d754c89f4`.
- Detail URL: `/works/30e95516-257d-4562-97b0-a1e5cf74197c?returnTo=%2Fread%2F30e95516-257d-4562-97b0-a1e5cf74197c%3Fpart%3D2b19b74a-78d5-478d-9dfd-902d754c89f4`.
- Return URL: the same Reader URL and `part` as entry.
- Desktop: PASS at the current built-in browser viewport. Exact 1440px was unavailable through the exposed browser controls.
- Mobile: NOT VERIFIED. The built-in browser exposed no 390px viewport control; no prohibited browser automation was used.
- Aesop’s Fables: NOT VERIFIED. It was not present in the available Library or History data, and Discover displayed “暂时没有可发现的内容”.

### Remaining Gaps

- The user's original Discover result remains unconfirmed; the exact sequence and starting URL that produced it are still unknown. No code change is justified without reproduction or further evidence.
- Exact 1440px and 390px viewports were not available in the current browser controls.
- Aesop’s Fables was unavailable in the current signed-in data.
- Existing private Work authorization and Saved Catalog Work data-path gaps recorded above remain unverified and are not closed by this navigation run.
- IA-02 remains PARTIAL pending these acceptance gaps and the user-reported failure’s reproduction; this run does not upgrade the full IA Phase 1 acceptance status.

### Git

- Branch: `dev-02`.
- HEAD: `6104d34de455e6b4a7adb41a4bad811c46bf1437` at task start; unchanged by this task.
- Changed Files: this report only was modified during this closure; no business source or test files were edited.
- Unrelated Changes Preserved: all existing dirty files, including `DESIGN.md`, IA Phase 1 changes, three pi-delegate deletions, `skills-lock.json`, and prior audit/design documents, were left untouched.
- No commit, Push, migration, Gutenberg sync, or service restart was performed.
