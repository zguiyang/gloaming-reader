export {
  assertModelAccessibleForActor,
  isProviderAccessibleForActor,
  rejectOwnerUserIdInPayload,
  requireInstanceProvider,
  requireUserOwnedProvider,
} from '@/domains/provider-scope/access';
export type { TtsConfigRow } from '@/domains/provider-scope/resolution';
export {
  loadInstanceTtsConfigRow,
  resolveScopedAppSettingValue,
  resolveScopedTtsConfigRow,
  selectUsableTtsConfig,
} from '@/domains/provider-scope/resolution';
export type { ProviderRuntimeActor } from '@/domains/provider-scope/types';
export { runtimeActorFromUserId } from '@/domains/provider-scope/types';
