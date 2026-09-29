# PR-03 — 发布单一事实来源（SSOT）

状态：已实现
实现提交：dac344508f8f10faa38aed1721e8bab49a3572c3
基线提交：a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6
分支：codex/user-first-pr03-publication-ssot
主要领域：发布转换语义
实现范围：使重复发布调用保留首次 `publishedAt`，并处理并发转换
评审类型：架构审计 / 维护者交接（Architecture Audit / Maintainer Handoff）
人工评审：待完成

## 1. 本阶段为何存在

发布由 `published_at` 表示后，重复发布调用不应重写发布历史，也不应仅因并发请求赢得转换而报告失败。

## 2. 之前

`publishWork` 每次调用将 `publishedAt` 设为新时间戳，且仅按 Work id 更新。因此重复发布会刷新时间戳；更新未表达 null 到已发布的转换，也无法从并发更新中干净恢复。

## 3. 之后

`publishWork` 要求 `processingStatus` 为 `ready`，检查既有发布门控，若已发布则不变返回，并在 `publishedAt` 为 null 时条件更新。竞态时重读行。本提交服务查找仍按 Work id；仅 Catalog 服务作用域在 PR-04 新增。`unpublishWork` 保留既有冲突行为。

## 4. Git 变更摘要

3 条修改路径，无增删：`admin-lifecycle.ts`、其 EPUB 功能规格与实现计划。无 schema、API 形态、路由注册或 Web 变更。

## 5. 逐文件变更清单

- apps/backend/src/domains/works/admin/admin-lifecycle.ts - 幂等发布转换与竞态重读。
- apps/backend/tests/functional/domains/works/works-epub.spec.ts - 重复发布/首次时间戳行为及周围发布回归。
- docs/plans/user-first-architecture-implementation.md - 记录本阶段及其验证。

## 6. 符号 / 方法清单

- `publishWork` - 幂等 Catalog 发布转换。
- `unpublishWork` - 行为保留；仍拒绝取消发布无 `publishedAt` 的行。
- `buildPublishIssuesForWork` - 既有发布就绪/业务校验仍在调用路径中。

## 7. 已删除代码清单

未删除函数、路由、schema 项或模块。在 `publishWork` 内新增条件更新与竞态读路径。

## 8. 数据库 / 数据模型

无 schema 或迁移。仅写入 `published_at`。处理状态保持 `ready`；发布不成为 status 值。

## 9. API 变更清单

无路由路径、请求或响应契约变更。Admin 发布端点行为幂等；重复发布保留首次 `publishedAt` 时间戳。

## 10. 运行时调用流

Admin 发布路由（`requireAdmin`）-> `publishWork` -> 就绪检查 -> 发布问题/就绪门控 -> 已有时间戳则返回 OR 条件更新 `publishedAt` -> 竞态重读 -> Admin Work 投影。本阶段尚无按 Work id 的 Catalog 作用域。

## 11. 行为变更

重复发布不再刷新发布时间。并发首次发布调用收敛于已写入行。仅 Catalog 服务作用域在 PR-04 到达。取消发布仍为独立的清除 `publishedAt` 操作；若已取消发布则冲突。

## 12. AI / 实现决策

- 首次发布时间戳为权威；重复调用不刷新新近度。为本阶段预期的幂等行为。
- 丢失更新竞态通过重读并返回当前状态处理，而非发出第二次转换。
- 本阶段保留默认 US 音频发布门控。

## 13. 测试与验证证据

历史 PR-03 报告：8 个后端功能测试文件，35/35 项测试；共享 Work 测试 14/14；后端/Web 类型检查、相关代码检查与 `git diff --check` 通过。ESLint 报告一条既有 Next image 警告、无错误。未在评审关卡 01 重跑；未报告完整单体仓库测试。

## 14. 遗留审计

- 未报告 `processingStatus='published'` 或 `'tts'` 运行时用法；负向契约测试可能提及遗留值。
- `isWorkPublished` 从 `publishedAt` 推导。
- 发布仍为 Catalog 发布；PR-02 的所有者读取访问独立。

## 15. 范围审计

恰为一处运行时方法加其回归测试与计划记录。无无关阶段或 PR-04/PR-05 运行时代码。

## 16. 前端影响

无。既有 Admin 客户端响应形态不变。

## 17. 复杂度增长

无新模块或抽象。在既有生命周期所有者内新增一次条件写入与一次竞态恢复读。三条可直接测试路径保留。

## 架构减法候选

- 本阶段无新减法候选。仅当变更后投影辅助成为无多调用方的转发包装时再评估。

## 隐藏产品决策

- 取消发布清除发布但不清除 `user_library_item` 行。PR-05 Library 查询隐藏未发布 Catalog Work，故保存项可在重新发布后再现。决定是否为此持久化有意：PR03-PRODUCT-002。
- 发布就绪仍要求 `ready` 与默认 US 音频；未实现惰性/非阻塞发布。
