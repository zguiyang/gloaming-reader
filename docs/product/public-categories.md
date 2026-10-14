# Public Categories — Current Module Boundary

Concise boundary for **public categories**: admin-managed classification of source records, separate from personal tags.

Related: [`personal-tags.md`](./personal-tags.md) · [`content-strategy.md`](./content-strategy.md) · [`mvp-scope.md`](./mvp-scope.md)

## 1. Boundary

- Public categories are **admin-operated classification on `SourceRecord`** entries — a shared, instance-level dimension of the Discover catalog.
- They are **separate from personal tags** (private, per-user): distinct domain identities, ownership, storage, and lifecycles. Source raw subjects/bookshelves remain source metadata and are not public categories.
- Category records carry stable IDs, localized labels, and provenance; Work display, if needed, derives through the SourceRecord link rather than duplicating assignments onto works.
- Categories are flat, broad, understandable, and reusable. They are not a hierarchy or one category per book.

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
- **Daily business quotas removed** — no instance daily classification reservation limit remains; quota-risk statements from earlier records are obsolete.

## 4. Verification status

- Real classification Worker, real classification/translation AI calls, and the Discover / save-read loop remain unverified. The reported management-page CRUD acceptance does not establish those results.
- This document records the current boundary and accepted semantics only; it **authorizes no new features**.
