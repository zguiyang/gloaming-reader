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

| 表面     | 说明                                       |
| -------- | ------------------------------------------ |
| Discover | 浏览真实英文书目，把想读的作品收藏进书架   |
| Library  | 个人书架：收藏、上传、标签，以及搜索与筛选 |
| Reader   | 安静阅读；查词、翻译、TTS                  |
| AI       | 页内同伴，不需要时消失                     |

Gloaming Reader 不是 Duolingo、LingQ、Anki、ChatGPT 阅读插件，也不是 AI 内容工厂。V1 规格：[`docs/product/mvp-scope.md`](./docs/product/mvp-scope.md)。开发优先级：[`docs/product/roadmap.md`](./docs/product/roadmap.md)。

## 技术栈（本地默认路径）

| 层          | 技术                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| 应用        | **Next.js**（`client/`）— UI、`/api/*` Route Handlers、Better Auth、Drizzle |
| Jobs        | 同包 BullMQ worker（`jobs/`，第二个进程）                                   |
| 数据        | PostgreSQL、Redis（端口 **6380**）、S3 兼容对象存储                         |
| 契约 / i18n | `client/shared/`、`client/i18n/`；数据库 schema 在 `client/server/db`       |

原 Hono API + 独立 web 应用在 [`archive/`](./archive/)（N5 降级，仅对照）。

## 环境要求

| 工具    | 版本                             |
| ------- | -------------------------------- |
| Node.js | ≥ 24.0.0                         |
| pnpm    | ≥ 10.0.0（或在仓库根目录用 Bun） |
| Docker  | 可选，用于本地 Postgres + Redis  |

## 本地开发

完整说明：[`docs/LOCAL_RUN.md`](./docs/LOCAL_RUN.md)。

```bash
git clone <repository-url>
cd gloaming-reader
```

### 1. 启动 Postgres 与 Redis（仓库根目录）

```bash
pnpm compose:init
docker compose up -d
```

默认连接见 `client/.env.example`：

- Postgres：`127.0.0.1:5433`，库 `gloaming_backend`
- Redis：`127.0.0.1:6380`

### 2. 环境变量

```bash
cp client/.env.example client/.env
```

`BETTER_AUTH_SECRET` 至少 16 个字符。设置 `FRONTEND_URL=http://localhost:3000`。API 为同源 `/api/*`，无需 `API_INTERNAL_URL`。

### 3. 安装与迁移（仓库根目录）

```bash
pnpm install   # 或 bun install
pnpm db:migrate
```

### 4. 运行（两个进程）

```bash
pnpm dev        # Next → http://localhost:3000
pnpm dev:jobs   # BullMQ worker
```

## 常用命令（仓库根）

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run build
pnpm run build:jobs
```

## 生产部署

默认叙事：单 Next 应用 + 可选 jobs worker。旧三服务部署说明见 [`docs/deployment.md`](./docs/deployment.md)（含归档对照）。

## 许可证

见 [LICENSE](./LICENSE)。
