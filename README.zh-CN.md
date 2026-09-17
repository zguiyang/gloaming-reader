# Gloaming Reader

[English](./README.md) | 简体中文

---

## 产品

**Gloaming Reader**（也称 **Gloaming**）是一个 **AI 原生语言阅读环境**。中文译名可以叫“书灯阅读”。它帮助用户像使用现代电子书阅读器一样阅读真实英文，遇到理解障碍时获得上下文相关的 AI 帮助，持续阅读自己真正想读的英文。

Gloaming 意为“暮色”，指昼夜交界的微光，也对应一个安静、让人继续读下去、需要帮助时就在身边的阅读空间。

目标用户不限年龄，包括学生、成人学习者、英语爱好者和高级读者。Gloaming Reader 提供一个能让用户读下去、卡住时获得帮助的环境。

产品理念与决策文档（英文 SSOT）：[`docs/product/`](./docs/product/)。领域模型：[`docs/adr/001-reading-content-domain-model.md`](./docs/adr/001-reading-content-domain-model.md)。

### 产品方向（主循环）

```text
选择真实英文内容 → 打开阅读 → 遇到语言障碍 → 获得上下文帮助 → 继续阅读
```

| 表面   | 说明                                              |
| ------ | ------------------------------------------------- |
| Shelf  | 官方书目（admin EPUB catalog）+ Phase 1b 用户导入 |
| Reader | 安静阅读；查词、翻译、TTS                         |
| AI     | 页内同伴，不需要时消失                            |

Gloaming Reader 不是 Duolingo、LingQ、Anki、ChatGPT 阅读插件，也不是 AI 内容工厂。V1 规格：[`docs/product/mvp-scope.md`](./docs/product/mvp-scope.md)。代码去留：[`docs/product/feature-audit.md`](./docs/product/feature-audit.md)。

## 技术栈

| 层     | 技术                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------- |
| API    | Hono、Better Auth、Drizzle、PostgreSQL、Redis（端口 **6380**）、session cookie（端口 **3333**） |
| Web    | Next.js App Router、React、TanStack Query/Form、Tailwind CSS v4（端口 **3000**）                |
| 包管理 | pnpm workspace（`apps/*`、`packages/*`）；`@gloaming/shared`、`@gloaming/db`                    |

## 环境要求

| 工具    | 版本                            |
| ------- | ------------------------------- |
| Node.js | ≥ 24.0.0                        |
| pnpm    | ≥ 10.0.0                        |
| Docker  | 可选，用于本地 Postgres + Redis |

## 本地开发

```bash
git clone <repository-url>
cd gloaming
pnpm install
```

### 1. 启动 Postgres 和 Redis

```bash
pnpm compose:init
docker compose up -d
```

默认连接（来自 compose / `.env.example`）：

- Postgres：`127.0.0.1:5433`，数据库 `gloaming_backend`（`DATABASE_URL`）
- Redis：`127.0.0.1:6380`（`REDIS_URL`）

### 2. 配置环境变量

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env
```

按需编辑 backend 环境变量。`BETTER_AUTH_SECRET` 至少 16 个字符：

```bash
openssl rand -base64 32
```

### 3. 运行数据库迁移

```bash
pnpm db:migrate
# 或开发期：pnpm db:push
```

### 4. 启动应用

```bash
# 终端 1：API http://localhost:3333
pnpm run dev:backend

# 终端 2：Web http://localhost:3000
pnpm run dev:web
```

浏览器打开 **http://localhost:3000**。

## 常用命令

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test
pnpm run build
```

## 生产部署

生产应用由 `web`、`api`、`worker` 三个服务组成；PostgreSQL、Redis 和 S3 兼容对象存储使用外部服务。部署说明见 [`docs/deployment.md`](./docs/deployment.md)。

## License

见 [LICENSE](./LICENSE)。
