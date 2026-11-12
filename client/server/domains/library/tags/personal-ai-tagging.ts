/**
 * Personal AI auto-tagging was removed from the Jobs whitelist.
 * Preference APIs remain as always-disabled stubs so leftover clients fail soft.
 * Manual personal tags are unchanged.
 */

export async function getPersonalTaggingPreference(_userId: string) {
  return {
    enabled: false,
    generation: 0,
    providerAvailable: false,
    latestRunState: null as null,
    latestRunErrorCode: null as null,
  };
}

export async function setPersonalTaggingPreference(_userId: string, _enabled: boolean) {
  return { enabled: false, generation: 0 };
}
