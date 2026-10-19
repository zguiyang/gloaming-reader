# Public Categories — Current Module Boundary

Concise boundary for **public categories**: admin-managed classification of source records, separate from personal tags.

Related: [`personal-tags.md`](./personal-tags.md) · [`content-strategy.md`](./content-strategy.md) · [`mvp-scope.md`](./mvp-scope.md)

## 1. Boundary

- Public categories are **admin-operated classification on `SourceRecord`** entries — a shared, instance-level dimension of the Discover catalog.
- They are **separate from personal tags** (private, per-user): distinct domain identities, ownership, storage, and lifecycles. Source raw subjects/bookshelves remain source metadata and are not public categories.
- Category records carry stable IDs, localized labels, and provenance; Work display, if needed, derives through the SourceRecord link rather than duplicating assignments onto works.
- Categories are flat, broad, understandable, and reusable. They are not a hierarchy or one category per book.
- **Public counts share list visibility:** the public `recordCount` uses the same predicate as the Discover record list (available record, enabled source, default Discover content language), so a category count never exceeds what the filtered list can show. Management counts still include records that are not publicly visible.

## 2. Admin CRUD semantics

- **CRUD:** admin list, create, edit localized labels, and delete category records. SourceRecord assignment management is a separate capability.
- **Delete an assigned category is rejected with 409** (no force delete).
- **Deleting an unassigned category cascades only owned labels, aliases, and suppressions.**
- Force deletion and bulk deletion are outside the accepted CRUD scope.
- **Reported acceptance:** the CRUD user report **passed on 2026-10-14** — recorded as reported acceptance, not re-tested by this documentation change.

## 3. AI classification

- AI classification uses the **instance provider**, not personal BYOK.
- The established classification contract allows zero to three categories per record; do not fill the count without evidence. This domain constraint is distinct from the removed daily business quotas.
- Distinguish concept identity from applicability: reuse an identity only for an equivalent concept, not merely a related or broader/narrower one. Existing categories or combinations may still apply to a book with a more specific topic.
- Prefer adequate existing coverage. Create a category only when coverage is insufficient and the concept has durable public navigation value. An empty catalog does not require a seeded vocabulary.
- Insufficient evidence permits abstention; ambiguity permits review. Neither result authorizes invented classifications or silent edits to existing categories.
- Classification and translation keep the same stable category identity, preserve manually edited labels and associations, and never rewrite raw source metadata. Missing translations remain explicitly incomplete and need a recoverable completion path.
- AI taxonomy review produces suggestions; destructive taxonomy changes require administrator confirmation. This does not add merge or bulk-management features.
- **Engineering safeguards retained:** bounded retry with provider-unavailable/transient handling, evidence fingerprinting, outbox dispatch, instance lock, and **manual-assignment/suppression protection** (manual labels and user decisions are never overwritten by AI).
- **Reclassification reconciles AI associations:** a completed pass (`REUSE`, `CREATE`, `NO_MATCH`) reconciles the record's AI-owned associations to that pass inside one SourceRecord-locked transaction — stale AI associations are removed, manual associations and suppression memory are never touched, and a `NEEDS_REVIEW` abstention leaves associations unchanged. The command result's `categoryIds` reports the associations actually persisted (including preserved manual rows), not the model's proposal.
- **Daily business quotas removed** — no instance daily classification reservation limit remains; quota-risk statements from earlier records are obsolete.

## 4. Verification status

- **Admin CRUD accepted (2026-10-14)** as reported acceptance (section 2).
- **Discover → save → library → detail → read loop page-accepted with the real record Gutenberg 11339 on 2026-10-18.** This is a page acceptance only; by itself it does not establish real AI classification or translation.
- **Bounded real-sample classification + translation accepted (2026-10-19, instance Provider 5fd0338d / ofox.ai / openai/gpt-6-luna; supervisor independently re-verified).** A 5-record bounded sample (external_id 1, 10, 11, 12, 65876) completed 5/5 on the first pass with no deferred or failed results: 8 successful real AI calls (5 classify + 3 translate; 6,049 input / 1,354 output tokens; the Provider returned no cost field, so `cost_amount` is empty). Three categories were created with bilingual labels (`edited_by=ai`) — United States History/美国历史, Children's Literature/儿童文学, Bible/圣经 — with associations 1→美国历史, 10→圣经, 11/12→儿童文学, and 65876 reusing the existing manual category 科幻小说. After verification the 5 records were re-frozen and the catalog is back to due=0; **the remaining 79,639 records stay frozen and were not batch-classified** — full-catalog/batch acceptance and multi-user acceptance were not executed, and the remaining outbox records were not processed.
- The reclassification reconciliation, public-count scope, and Save Intent status read remain verified by automated tests only (mocked AI results, isolated test database/Redis).
- **Known gap (awaiting a product decision):** translation is triggered only when a category is created; when an existing manual category lacks a locale label (e.g. 科幻小说, 童话语言 missing en-US), there is no in-product trigger to complete the missing translation.
- Automated tests prove only the semantics they cover; the reported management-page CRUD acceptance, the real-record page loop acceptance, and the bounded real-sample AI acceptance each establish only what they exercised.
- This document records the current boundary and accepted semantics only; it **authorizes no new features**.
