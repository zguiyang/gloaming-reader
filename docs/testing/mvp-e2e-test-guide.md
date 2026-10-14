# Gloaming E2E Test Guide (current)

Current test **procedure** for Gloaming. It is a procedure, not acceptance proof: it contains no recorded results, and a guide that exists does not mean anything has passed.

**References:** [product docs](../product/README.md) · [personal tags](../product/personal-tags.md) · [public categories](../product/public-categories.md) · [deployment](../deployment.md) · [AGENTS.md](../../AGENTS.md) · [test database Skill](../../.agents/skills/test-database-workflow/SKILL.md)

---

## 1. Safety (mandatory)

- **Automated tests that write persistent data** must run only against the verified isolated test database `gloaming_test` with its test Redis, confirmed via the [test DB Skill](../../.agents/skills/test-database-workflow/SKILL.md). If it cannot be confirmed, **stop** — never fall back to development or production.
- **Interactive browser acceptance** may use the verified local development environment. Scope data you create with an `ACCEPT-*` prefix/identifier and clean up **only that data**. Do **not** clean or flush shared Redis.
- **Production** is out of scope for this guide. No production reads or writes.
- Services and containers: use the existing setup described in [deployment](../deployment.md) and the infrastructure-operations Skill. Do not invent commands or containers, and never suggest deleting volumes.

## 2. Order of verification

1. **Relevant unit/API tests first** — run only the suites relevant to the change (focused checks during feature work; broaden only with impact).
2. **Relevant interactive browser checks** — in the internal browser, cover only the flows in scope for this task. A bounded task does **not** require every module for each acceptance.
3. Report per §6. Do not claim a layer you did not run (unit PASS ≠ browser PASS).

**Login:** sign in as the test user in the browser; do not put passwords in chat or logs.

## 3. Surfaces in scope

User: `/library` · `/library/tags` · `/discover` · `/works/[workId]` · `/read/[workId]` · `/reading-history` · `/settings` · `/account`.
Admin: `/admin/public-categories`.

Domain reminders:

- **Library** = owned personal works ∪ explicitly saved catalog membership (`UserLibraryItem`). Reading progress (`ReadingState`) is **separate**: saving does not start progress; removing membership retains progress.
- Work cards open `/works/[workId]`; explicit Read / Continue Reading open `/read/[workId]`. Detail returns accept safe Library / Discover / History / same-work Reader origins.

## 4. Module procedures (scope each run explicitly)

### 4.1 Personal tags

- **Unit:** run the [name-normalization tests](../../apps/backend/tests/unit/domains/library/user-tag-normalization.spec.ts). Pure tests do not require a database.
- **API:** run the [User Tag functional tests](../../apps/backend/tests/functional/domains/library/user-tags.spec.ts) only against the confirmed isolated environment.
- **Web:** `/library/tags` and Library tag filters — create, rename/locale edit, delete, AND-filter reflected in the URL.
- **Invariants:** tags are private to their owner; tag names unique per owner; deleting a tag **keeps** the books and their progress.
- **Translation:** creating a tag may invoke AI for a localized name. In normal test runs use the **mock / no-provider** path in a controlled environment. A **real model call requires express authorization** for that run. Do **not** disable the feature to avoid the call.

### 4.2 Public categories (admin CRUD)

- Admin CRUD on `/admin/public-categories`: create, edit, delete.
- Delete an **assigned** category → `409`; delete an **unassigned** category → `204`; nonexistent id → `404`.
- Non-admin access → `401` / `403`.
- CRUD does **not** require source import or a Worker run.

### 4.3 User EPUB ingestion (separately scoped)

Only when the task includes it: upload via the personal flow, confirm processing and explicit failure states, personal ownership (private), and appearance in Library. Verify recovery actions only where implemented; do not add them to expand acceptance scope.

### 4.4 Reader progress (separately scoped)

Read a part, verify position resume via ReadingState, Continue Reading, and that Library membership changes never alter progress.

### 4.5 Auth / Settings (separately scoped)

Sign-up/sign-in/out and session persistence. `/settings` manages user BYOK; administrator provider settings manage the instance. User edits must not change instance scope.

### 4.6 AI / TTS / Worker (separately scoped)

Identify the target and side effects before running. Real model requests must stay within the user's authorized provider and call scope. Automated queue tests require verified isolated resources; interactive development acceptance must not consume unrelated jobs. Reuse a suitable existing dedicated entry rather than expanding a CRUD task into Worker development. Real AI acceptance is separate from mock/API/UI verification.

## 5. Statuses

| Status    | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `NOT_RUN` | In scope but not executed                            |
| `PASS`    | Executed, behavior matched expectation               |
| `FAIL`    | Executed, mismatch — file a defect                   |
| `PARTIAL` | Some checks executed, others not                     |
| `BLOCKED` | Environment/approval missing — not a product failure |

Every entry states **evidence** (command + suite, or screen/URL + observable) and **scope** (test DB vs local dev, mock vs real AI). Never record results that were not observed.

## 6. Report template

```markdown
## <task> — test report

- Date / tester:
- Environment: gloaming_test (confirmed: yes/no) | local dev | n/a
- Scope run: [modules from §4, statuses above]

| Check            | Status  | Evidence | Scope/notes       |
| ---------------- | ------- | -------- | ----------------- |
| <unit/API suite> | PASS    | <cmd>    | gloaming_test     |
| <browser flow>   | NOT_RUN | —        | pending <blocker> |

- Cleanup: <ACCEPT-* data removed; shared Redis untouched>
- Unverified: <layers/approvals not run>
```

## 7. Out of scope

Practice/Review/SRS, lesson/course entities, quota monetization, source-import/Worker pipelines (unless specifically approved), real AI calls (unless expressly authorized), and any recorded "PASS" carried over from older reports.
