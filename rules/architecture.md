# Architecture and module boundaries

Apply this rule when changing ownership, dependencies, public boundaries, or
module placement. Ordinary local edits do not require a separate architecture
review. Use a relevant structure Skill for execution methods.

## Deploy unit vs logical boundaries

Accepted deploy/API direction:
[Cloudflare fullstack refactor guidance](../docs/cloudflare-fullstack-refactor-guidance.md).

- **Current deploy unit:** repo-root single Next package (UI + HTTP APIs) with
  an optional same-package BullMQ worker (`jobs/`). Legacy `web+api+worker`
  sources live under `archive/apps/*` for comparison only.
- **Target platform:** same Next deploy unit on managed data plane; Cloudflare
  Workers compatibility is a gated P4 track (P4-V1 build/Preview done; P4-V2 not).
- **Logical boundaries remain:** a single deploy unit does **not** authorize
  folding server domain logic into UI modules, dissolving `shared/` or
  `server/db` ownership, or inventing a new shared kitchen-sink layer.
- **Hono** is not in the live tree and is not the long-term API host. Do not
  reintroduce nested Hono inside Next unless the guidance is amended.
- **Jobs / queues** are optional for open-source delivery. Do not treat BullMQ
  worker presence as required Cloudflare architecture.
- **Current vs target mismatch** (Node/Jobs vs Workers) is expected. Report it;
  do not silently pick “code today” or “target doc” and proceed on high-impact
  moves without an explicit task and gates.

## Ownership and dependency direction

- Identify the current owner from definitions, imports, consumers, and accepted
  decisions. Ownership follows semantic responsibility, lifecycle, dependencies,
  and reason to change; a consumer's location or usage count does not transfer it.
- Each fact, contract, policy, and normalization rule has one authoritative
  owner. Import or derive it rather than introducing a competing definition.
- Keep cohesive capabilities simple. Split only for a meaningful owner and a
  distinct change reason, lifecycle, state, dependency, test surface, or public
  contract. File size, prefixes, file count, and consumer count are investigation
  signals, not automatic split or promotion criteria.
- Make ownership discoverable through placement and recorded boundaries. A flat
  directory or lack of external consumers does not prove internal cohesion.
- Keep technical adapters separate from domain behavior. Composition may assemble
  capabilities; capability internals must not depend on composition's private
  implementation. Do not add a generic shared layer or abstraction for
  hypothetical reuse.

## Public boundaries

- Internal implementation is private by default. Cross-boundary consumers use
  intentional public entries, not private files. A filename, barrel, directory,
  or export alone does not grant public permission.
- An application public entry requires an owner, explicit entry path, recorded
  public intent, and either a real cross-boundary consumer or a concrete stable
  contract/framework requirement. Record that requirement when it justifies an
  entry without consumers; anticipated reuse is insufficient.
- Public entries expose explicit intentional symbols; do not use `export *` to
  avoid deciding the public surface. A barrel is optional, and separate public
  entries may serve distinct transport and client-runtime boundaries.
- Cross-boundary contract imports use `@/shared/<module>` (and `@/i18n`) rather
  than deep relative imports into private Shared sources. Accepted decisions
  govern the public module map; see [package rules](packages.md).
- A temporary private-boundary import requires a recorded owner, target public
  entry, affected scope, and exit condition. It is a transition exception, not
  an implicit permission or a completed migration.

## Architectural changes and acceptance

- Before changing module responsibilities, dependency direction, public module
  maps, or core domain contracts, identify the effective accepted boundaries and
  inspect affected producers/consumers, configuration, and tests. Consult decision
  records as needed to resolve missing context or conflicting evidence. Confirm
  the intended boundary and compatibility strategy before implementation.
- Changing an accepted decision requires an accepted amendment or successor.
  Draft records and current implementation differences do not authorize a new
  decision. If substantive ownership or intent remains unclear, preserve the
  effective boundary and report the unresolved choice.
- A migration must handle intended imports, exports, tests, and configuration
  references together. Remove the old boundary or deliberately retain it with
  an owner, compatibility behavior, affected consumers, and removal condition.
- Verify the whole intended migration with impact-matched checks. Report partial,
  deferred, blocked, and complete distinctly; unresolved ownership or consumer
  migration prevents a completion claim. For rule changes, also check the
  relevant failure scenario against the resulting rule text.

Concrete owners and settled entry paths belong in accepted architecture records;
current layouts, commands, and versions come from source and configuration.
