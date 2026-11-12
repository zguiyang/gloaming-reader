import { Loader2Icon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { getClientLocale } from '@/lib/client-locale';
import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t(getClientLocale(), 'common.loading')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
