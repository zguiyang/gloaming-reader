# PR-08 — 用户设置 / 自带 API 前端

## 1. 元数据

| 字段     | 值                                                                 |
| -------- | ------------------------------------------------------------------ |
| 阶段     | PR-08                                                              |
| 分支     | `codex/user-first-pr08-settings-byok`                              |
| Worktree | `~/.codex/worktrees/user-first-pr08-settings-byok/gloaming-reader` |
| 基线提交 | `7cef05b59c814a14e48821cec69ae060457dd9eb`                         |
| 实现提交 | `4f240d25fd0c7008c19e3e6f31cb88cba66ba803`                         |
| 审查提交 | 本文件所在提交；完整 SHA 见 Git 历史                               |
| 主要领域 | 用户设置 / 自带 API 前端                                           |
| 人工评审 | 待完成                                                             |

## 2. PR-08 的目的

PR-06 已提供用户自己的 LLM Provider、Model、用途映射和 TTS 配置 API，但前端没有用户设置入口。本阶段新增普通用户 `/settings`，将 AI 配置与朗读配置接入 PR-06 User API，并保持账户资料、邮箱和密码继续由 `/account` 管理。

## 3. 已实现的产品决策

- 用户可选择「默认服务」或「使用自己的 API」；不暴露作用域、Resolver 或归属字段。
- AI 配置保留服务、模型及三种实际存在的阅读用途映射。
- 朗读按后端唯一可配置的 Azure 用户级 TTS DTO 展示，不伪造 Provider 选择器。
- 配置只在用户显式点击保存后提交；修改其他字段时省略空的 API Key 字段。
- Settings 入口加入桌面账户菜单和移动 `/more` 页面；账户资料操作仍留在 `/account`。

## 4. 使用的后端契约

| 能力     | PR-06 API                                                                              | 契约范围                                                                                      |
| -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| LLM 服务 | `GET/POST /api/settings/llm/providers`、`PATCH/DELETE /api/settings/llm/providers/:id` | `apiFamily`、名称、Base URL、可选代理和 thinking 参数、启用状态；响应仅含 `apiKeySet` 与 mask |
| LLM 模型 | `GET/POST /api/settings/llm/models`、`PATCH/DELETE /api/settings/llm/models/:id`       | Provider、模型 ID、显示名、wire variant 及可选运行参数                                        |
| 用途映射 | `GET /api/settings/llm/settings`、`PUT /api/settings/llm/settings/:key`                | `assist.default_model_id`、`translate.default_model_id`、`metadata-enrich.default_model_id`   |
| 用户 TTS | `GET/PUT /api/settings/tts/config`                                                     | Azure、区域、启用状态、API Key mask 与默认/美式/英式声音                                      |

LLM family registry 有 OpenAI、Anthropic、Gemini；当前只有 OpenAI family 的运行时已接入。UI 显示尚未接入的状态，不允许将这类模型加入可选用途列表。用户端没有 Test Connection 或模型远端发现接口，本 PR 未添加假按钮或扩大后端范围。

## 5. 改动前

- 没有 `/settings` 页面或用户端 `/api/settings/*` 前端客户端。
- 桌面账户菜单只有账户、Admin（适用时）和退出；移动 `/more` 只有账户设置入口。
- `/account` 管理用户资料、邮箱与密码。

## 6. 改动后

- 新增 `/settings`，以「AI」和「朗读」标签组织现有能力。
- AI Provider、Model、用途映射和 TTS 配置均调用 PR-06 用户 API。
- 用户可显式切换默认/自有服务；AI 的默认模式会停用所有个人 Provider，TTS 的默认模式会将个人配置保存为 `isEnabled=false`。
- 桌面账户菜单和移动 `/more` 页面都可打开设置。

## 7. 设计理由

页面沿用 Gloaming 的页面标题、Tabs、字段、留白和细分隔线，不叠加设置卡片或仪表盘。Provider 的代理与 thinking 参数放入原生折叠区域；普通用户先看到服务来源和必要字段。朗读标题使用「朗读」，而不是内部 TTS 名称。

## 8. 设置的信息架构

`/settings` 的两组配置互不混用：AI 负责 Provider、Model 与阅读用途；朗读负责用户级 TTS 区域、密钥和 API DTO 已支持的声音偏好。账户资料和凭据仍由 `/account` 持有。

## 9. AI 设置流程

用户选择「使用自己的 API」并保存后，个人 Provider 启用；页面可添加/编辑/删除服务、添加/编辑/删除模型，并为辅助、翻译和作品信息整理选择模型。用途选择与 Provider、Model 表单均有明确的保存动作。

## 10. 朗读设置流程

用户级 TTS API 仅支持 Azure。选择自有 API 后填写区域和密钥，可设置默认、美式与英式声音；保存通过 `PUT /api/settings/tts/config`。已保存的密钥留空表示保留现值。选择默认服务后需显式保存停用状态。

## 11. 默认服务 / 自有 API 语义

后端每次 LLM 请求先尝试有效的用户配置，再尝试实例配置；Provider 被禁用后，其绑定无法解析，Resolver 会尝试实例服务。TTS 对应语义为用户配置不可用或被停用后选择实例配置。运行时上游调用失败不会由本 UI 宣称为自动切换。

PR-06 没有删除单个 AI 用途映射的接口。因此默认模式按现有契约停用全部个人 LLM Provider，原用途映射保留；页面不伪造单用途清除 API。重新启用自有模式会重新启用这些 Provider。

## 12. Provider / Model 管理

Provider family、wire variant、名称、URL、API Key 及 DTO 支持的可选代理/thinking 参数均来自 shared contract / registry。模型 CRUD 使用真实的模型 ID、显示名称与 wire variant。用途选项只包含已启用且运行时可用的个人模型。

若删除操作被现有后端约束拒绝（例如模型仍被用途映射引用），页面显示后端错误；没有增加绕过约束的删除路径。

## 13. 密钥处理

- API Key 使用 password input；保存后的 key 只显示后端 mask 或「已配置」。
- 编辑时输入框初始为空；仅非空新值才会加入 LLM PATCH / TTS PUT 请求。
- LLM 与 TTS 查询缓存只保存 DTO mask，不保存完整密钥。
- 保存成功后 TTS 临时密钥状态随配置刷新重置；没有日志、Toast 或文档打印密钥的代码。

## 14. 导航入口

- 桌面：账户菜单新增「设置」，通过 `/settings` 打开。
- 移动：`/more` 新增「设置」行；账户资料入口保持原样。
- 未修改主导航、底部导航、AccountMenu 结构或 Admin 入口行为。

## 15. 运行时集成

Provider、Model、用途映射保存后失效 `user-settings/llm` 查询前缀；TTS 保存后更新并失效 TTS 配置查询。Reader 的 AI / TTS 请求是新 HTTP 请求，后端 resolver 在每次调用时读取当前配置，因此无需重载页面或重新登录。没有新增 Reader 查询缓存或改变 Reader UI。

## 16. 安全

所有请求使用现有认证 API transport，不发送 `ownerUserId` / `owner_user_id`。用户配置的读取、更新、删除调用 PR-06 user routes；后端按认证 session 的用户身份限制访问。前端没有跨用户 owner 字段或 Admin 配置客户端依赖。

## 17. 响应式行为

Settings 页面使用既有 AppShell，表单窄屏单列、宽屏按字段语义分列。桌面账户菜单与 `/more` 按现有容器适配；没有新导航模式、固定侧栏或移动底栏项目。

## 18. 可访问性

- 表单字段均有关联标签，校验错误使用现有 `FieldError`。
- 密码字段有 `autoComplete="new-password"`，不会将 mask 填入输入值。
- 标签页、服务模式组和下拉框有可访问名称；按钮 pending 时禁用。
- 加载与 API 错误有文本状态；服务来源切换不依赖颜色单独传递。

## 19. 测试与验证

| 检查                       | 结果                                      |
| -------------------------- | ----------------------------------------- |
| Settings API 定向测试      | 1 个文件，4 项通过                        |
| Web 全套测试               | 48 个文件，245 项通过                     |
| i18n 测试                  | 2 个文件，10 项通过                       |
| Web TypeScript             | 通过                                      |
| 变更文件 ESLint            | 通过                                      |
| Prettier                   | 通过                                      |
| `git diff --check`         | 通过                                      |
| Shared / Backend 定向测试  | 未运行；本 PR 未改 shared 或 backend 源码 |
| Backend / 全仓正式测试脚本 | 未运行                                    |
| E2E                        | 未运行                                    |

补充：首次通过仓库根启动 Vitest 时，`apps/web/vitest.config.ts` 的 glob 从仓库根递归收集了多个 workspace。该次跨 workspace 调用 202 个测试文件中 116 个文件通过、86 个文件失败；6 项测试失败、748 项通过，失败输出显示 Backend 测试的 `@/…` 别名无法解析。之后按正确根目录运行 Web 全套 48 文件并全部通过。该次误范围调用不作为正式全仓测试结果。

执行 `pnpm --filter @gloaming/web typecheck` 时，pnpm 发现隔离 worktree 缺少依赖并触发安装；`nodejieba` 在 Node 26 下的原生构建失败。随后改用仓库现有 TypeScript / ESLint / Prettier / Vitest 二进制完成验证；没有修改 manifest 或 lockfile。

## 20. 旧接口与边界审计

- Settings Web runtime 对 `/api/admin/llm/*`：0 次引用。
- Settings Web runtime 对 `/api/admin/tts/*`：0 次引用。
- 用户可见文案中的 `User Provider`、`Instance Provider`、`Resolver`、`BYOK`：0 次。
- Web 请求中的 `ownerUserId` / `owner_user_id`：0 次。
- API Key 完整值渲染：0 次；响应和表单状态只有 mask / 用户输入。
- 其余 API client 字符串均为 `/api/settings/llm/*` 与 `/api/settings/tts/config`。

## 21. Anti-AI 设计审计

| 检查项              | 结果                                             |
| ------------------- | ------------------------------------------------ |
| Dashboard 风格      | 无；只有设置标签与表单                           |
| Bento 布局          | 无                                               |
| 卡片堆叠 / 嵌套卡片 | 无                                               |
| 设置卡片过载        | 无；分组使用标题和分隔线                         |
| 列表行过多          | 无；配置字段与模型项按对象内聚                   |
| 多余 helper copy    | 未添加长段营销说明；仅保留密钥和默认服务所需说明 |
| 后端术语暴露        | 无；API family 名称为用户设置连接配置所需名称    |
| 新视觉语言          | 无；复用 DESIGN.md 语义 token 和既有控件         |

## 22. AI 参与决策

- AI 与朗读使用两个设置标签，保留各自真实 API 和独立保存行为。
- API 缺少单用途 AI 映射清除方法，因此「默认服务」通过停用所有个人 Provider 实现；映射保留，避免凭空调用未存在的接口。
- Registry 中未接入运行时的 family 仍可显示其真实服务类型，但不会出现在可用于阅读用途的模型选项中。
- 根据模块边界规则，将有独立 DTO、字段状态和保存生命周期的朗读表单拆到 `settings/tts/`；页面仍是其唯一组合点。

## 23. 范围审计

- Library 重设计：无。
- Reader 重设计：无。
- Admin 配置重设计：无。
- Provider schema / 数据库 schema 重设计：无。
- Backend runtime 修改：无。
- Billing / Quota：无。
- Lazy TTS：无。
- `/account` 资料/邮箱/密码流程重写：无。

## 24. 延后视觉验收

`Runtime Visual Verification: Deferred`。本轮没有启动 `dev:*`、`start` 或 `preview`，也没有在浏览器检查运行时页面。

`Human Visual Acceptance: Pending`。PR-07 的 `FRONTEND-VISUAL-001` 保持 Pending；新增 `FRONTEND-VISUAL-002`，在最终 Integration Branch 执行 Settings / BYOK 桌面、移动、Light/Dark runtime visual acceptance。

## 25. 剩余缺口

- 后端无单个 LLM 用途映射删除 API；UI 只能通过停用所有个人 Provider 回到默认 resolver 配置。
- 用户端无 Test Connection、远端模型发现或实例默认服务状态查询能力；本 PR 不伪造这些能力。
- Anthropic / Gemini family 目前尚无运行时实现，配置模型不能用于阅读用途。
- 真实桌面、移动和 Light/Dark 视觉验收待最终集成分支；需人工复核。

## 26. 最终状态

PR-08 在基线 `7cef05b59c814a14e48821cec69ae060457dd9eb` 上实现，新增普通用户 `/settings`、桌面与移动入口以及 User LLM / TTS API 消费方。实现提交为 `4f240d25fd0c7008c19e3e6f31cb88cba66ba803`。审查文档提交位于实现提交之后；其 SHA 由 Git 历史确定。人工评审待完成；运行时视觉验收延后；未 Push、未 Merge、未创建 PR、未开始 PR-09。
