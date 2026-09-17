# Gloaming Reader

[简体中文](./README.zh-CN.md) | English

---

## Product

**Gloaming Reader** (also **Gloaming**) is an **AI Native Language Reading Environment**: read authentic English the way you use a modern ebook reader, with contextual AI help when meaning breaks down. The Chinese name may be written as **书灯阅读**. The core is helping people **keep reading English they actually want to read**.

Gloaming means twilight—the quiet light between day and night, reflecting a calm reading space where help is close when you get stuck.

Who: **no age gate**—students, adult learners, enthusiasts, and advanced readers. Gloaming provides an environment that lets people keep reading, with help when they get stuck.

Product vision and decision docs (English SSOT): [`docs/product/`](./docs/product/). Domain model: [`docs/adr/001-reading-content-domain-model.md`](./docs/adr/001-reading-content-domain-model.md).

### Product direction (main loop)

```text
Choose authentic English → Read → Contextual help when stuck → Keep reading
```

| Surface | Role                                                    |
| ------- | ------------------------------------------------------- |
| Shelf   | Official catalog (admin EPUB) + user import in Phase 1b |
| Reader  | Calm reading; lookup, translation, TTS                  |
| AI      | In-page companion; disappears when not needed           |

Gloaming is not Duolingo, LingQ, Anki, a ChatGPT reading plugin, or an AI content factory. V1 spec: [`docs/product/mvp-scope.md`](./docs/product/mvp-scope.md). Code vs bet: [`docs/product/feature-audit.md`](./docs/product/feature-audit.md).

## Stack

| Layer    | Tech                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| API      | Hono, Better Auth, Drizzle, PostgreSQL, Redis (port **6380**), session cookie (port **3333**) |
| Web      | Next.js App Router, React, TanStack Query/Form, Tailwind CSS v4 (port **3000**)               |
| Packages | pnpm workspace (`apps/*`, `packages/*`); `@gloaming/shared`, `@gloaming/db`                   |

## Requirements

| Tool    | Version                              |
| ------- | ------------------------------------ |
| Node.js | ≥ 24.0.0                             |
| pnpm    | ≥ 10.0.0                             |
| Docker  | optional, for local Postgres + Redis |

## Local development

```bash
git clone <repository-url>
cd gloaming
pnpm install
```

### 1. Start Postgres and Redis

```bash
pnpm compose:init
docker compose up -d
```

Defaults (from compose / `.env.example`):

- Postgres: `127.0.0.1:5433`, database `gloaming_backend` (`DATABASE_URL`)
- Redis: `127.0.0.1:6380` (`REDIS_URL`)

### 2. Environment files

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env
```

Edit the backend environment as needed. `BETTER_AUTH_SECRET` must be at least 16 characters:

```bash
openssl rand -base64 32
```

### 3. Run DB migrations

```bash
pnpm db:migrate
# or during early development: pnpm db:push
```

### 4. Run apps

```bash
# Terminal 1: API http://localhost:3333
pnpm run dev:backend

# Terminal 2: Web http://localhost:3000
pnpm run dev:web
```

Open **http://localhost:3000**.

## Common commands

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test
pnpm run build
```

## Production deployment

The production application consists of `web`, `api`, and `worker` services. PostgreSQL, Redis, and S3-compatible object storage are external services. Build and deployment instructions: [`docs/deployment.md`](./docs/deployment.md).

## License

See [LICENSE](./LICENSE).
