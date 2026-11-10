export type { WorkReadActor } from '@/domains/works/access/actor';
export { anonymousWorkReadActor, workReadActorFromIdentity } from '@/domains/works/access/actor';
export type { ReadablePartAccess } from '@/domains/works/access/policy';
export {
  assertCanReadWork,
  canReadWork,
  requireReadablePart,
  requireReadableWorkWithParts,
  resolveReadableWorkIdForPart,
  resolveReadableWorkTitle,
} from '@/domains/works/access/policy';
export type { WorkAccessRow } from '@/domains/works/access/predicate';
export { isPublicCatalogWork, publicCatalogWorkSql, workReadAccessSql } from '@/domains/works/access/predicate';
