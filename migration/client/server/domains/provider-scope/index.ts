export {
  assertModelAccessibleForActor,
  isProviderAccessibleForActor,
  rejectOwnerUserIdInPayload,
  requireInstanceProvider,
  requireUserOwnedProvider,
} from '@/server/domains/provider-scope/access';
export type { TtsConfigRow } from '@/server/domains/provider-scope/resolution';
export {
  loadInstanceTtsConfigRow,
  resolveInstanceAppSettingValue,
  resolveInstanceTtsConfigRow,
  resolveScopedAppSettingValue,
  resolveScopedTtsConfigRow,
  resolveUserOwnedAppSettingValue,
  selectUsableTtsConfig,
} from '@/server/domains/provider-scope/resolution';
export type { ProviderRuntimeActor } from '@/server/domains/provider-scope/types';
export { runtimeActorFromUserId } from '@/server/domains/provider-scope/types';
