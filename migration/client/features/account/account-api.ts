import { useQuery } from '@tanstack/react-query';

import { authClient } from '@/lib/auth';

export const accountQueryKey = {
  all: ['account'] as const,
  linkedAccounts: () => [...accountQueryKey.all, 'linked-accounts'] as const,
};

export function useLinkedAccountsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountQueryKey.linkedAccounts(),
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) {
        throw result.error;
      }
      return result.data;
    },
    enabled: options?.enabled ?? true,
  });
}
