/** Runtime/config actor for provider and TTS resolution. */
export type ProviderRuntimeActor = { kind: 'anonymous' } | { kind: 'authenticated'; userId: string };

export function runtimeActorFromUserId(userId?: string | null): ProviderRuntimeActor {
  if (userId) {
    return { kind: 'authenticated', userId };
  }
  return { kind: 'anonymous' };
}
