export type { WorkReadActor } from '@/domains/works/access/actor';
export { anonymousWorkReadActor, isWorkReadAdmin, workReadActorFromIdentity } from '@/domains/works/access/actor';
export type { ReadablePartAccess } from '@/domains/works/access/policy';
export {
  assertCanReadWork,
  requireReadablePart,
  requireReadableWorkWithParts,
  resolveReadableWorkIdForPart,
  resolveReadableWorkTitle,
} from '@/domains/works/access/policy';
export type { WorkAccessRow } from '@/domains/works/access/predicate';
export {
  canReadWorkRow,
  isPublicCatalogWork,
  publicCatalogWorkSql,
  workReadAccessSql,
} from '@/domains/works/access/predicate';
