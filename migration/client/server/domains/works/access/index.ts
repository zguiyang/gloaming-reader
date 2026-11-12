export type { WorkReadActor } from '@/server/domains/works/access/actor';
export { anonymousWorkReadActor, workReadActorFromIdentity } from '@/server/domains/works/access/actor';
export type { ReadablePartAccess } from '@/server/domains/works/access/policy';
export {
  assertCanReadWork,
  canReadWork,
  requireReadablePart,
  requireReadableWorkWithParts,
  resolveReadableWorkIdForPart,
  resolveReadableWorkTitle,
} from '@/server/domains/works/access/policy';
export type { WorkAccessRow } from '@/server/domains/works/access/predicate';
export { isPublicCatalogWork, publicCatalogWorkSql, workReadAccessSql } from '@/server/domains/works/access/predicate';
