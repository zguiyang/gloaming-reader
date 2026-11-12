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

| Surface  | Role                                                                 |
| -------- | -------------------------------------------------------------------- |
| Discover | Browse authentic catalog works, then save what you want to read      |
| Library  | Personal shelf: saved catalog works, uploads, tags, search & filters |
| Reader   | Calm reading; lookup, translation, TTS                               |
| AI       | In-page companion; disappears when not needed                        |

Gloaming is not Duolingo, LingQ, Anki, a ChatGPT reading plugin, or an AI content factory. V1 spec: [`docs/product/mvp-scope.md`](./docs/product/mvp-scope.md). Development priorities: [`docs/product/roadmap.md`](./docs/product/roadmap.md).

## Stack (local default)

| Layer            | Tech                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| App              | **Next.js** (`client/`) — UI, `/api/*` Route Handlers, Better Auth, Drizzle                |
| Jobs             | Same package — BullMQ worker (`jobs/`, second process)                                     |
| Data             | PostgreSQL, Redis (port **6380**), S3-compatible object storage                            |
| Contracts / i18n | `client/shared/`, `client/i18n/` (`@/shared/*`, `@/i18n`); DB schema in `client/server/db` |

The former Hono API + separate web app live under [`archive/`](./archive/) for comparison only (N5 demote).

## Requirements

| Tool    | Version                              |
| ------- | ------------------------------------ |
| Node.js | ≥ 24.0.0                             |
| pnpm    | ≥ 10.0.0 (see root `packageManager`) |
| Docker  | optional, for local Postgres + Redis |

## Local development

Full runbook: [`docs/LOCAL_RUN.md`](./docs/LOCAL_RUN.md).

```bash
git clone <repository-url>
cd gloaming-reader
```

### 1. Start Postgres and Redis (repo root)

```bash
pnpm compose:init
docker compose up -d
```

Defaults (from compose / `client/.env.example`):

- Postgres: `127.0.0.1:5433`, database `gloaming_backend` (`DATABASE_URL`)
- Redis: `127.0.0.1:6380` (`REDIS_URL`)

### 2. Environment

```bash
cp client/.env.example client/.env
```

Edit as needed. `BETTER_AUTH_SECRET` must be at least 16 characters:

```bash
openssl rand -base64 32
```

Set `FRONTEND_URL=http://localhost:3000`. APIs are same-origin `/api/*` (no `API_INTERNAL_URL`).

### 3. Install and migrate (repo root)

```bash
pnpm install
pnpm db:migrate
```

### 4. Run (two processes)

```bash
# Terminal 1 — Next http://localhost:3000
pnpm dev

# Terminal 2 — BullMQ worker
pnpm dev:jobs
```

Open **http://localhost:3000**.

## Common commands (repo root)

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run build
pnpm run build:jobs
```

## Production deployment

**Default narrative:** one Next app (`client/`) + optional jobs worker; data plane external. Legacy three-service Docker layout is documented for archived code — see [`docs/deployment.md`](./docs/deployment.md).

## License

See [LICENSE](./LICENSE).
