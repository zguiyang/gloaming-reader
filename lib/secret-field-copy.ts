import type { SecretFieldCopy } from '@/components/ui/secret-field';
import { type Locale, t } from '@/i18n';

/** Shared copy for the saved-secret pattern so all call sites stay in sync. */
export function getSecretFieldCopy(locale: Locale): SecretFieldCopy {
  return {
    replaceLabel: t(locale, 'common.secret.newKey'),
    replaceAction: t(locale, 'common.secret.replace'),
    cancelReplaceAction: t(locale, 'common.secret.cancelReplace'),
    keepHint: t(locale, 'common.secret.keepHint'),
    configuredLabel: t(locale, 'common.secret.configured'),
  };
}
