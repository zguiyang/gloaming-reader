export type { WorkReadActor } from '@/server/domains/works/access/actor';
export { workReadActorFromIdentity } from '@/server/domains/works/access/actor';
export type { ReadablePartAccess } from '@/server/domains/works/access/policy';
export {
  assertCanReadWork,
  canReadWork,
  listReadableWorkIds,
  requireReadablePart,
  requireReadableWorkWithParts,
  resolveReadableWorkIdForPart,
  resolveReadableWorkTitle,
} from '@/server/domains/works/access/policy';
export { workReadAccessSql } from '@/server/domains/works/access/predicate';
