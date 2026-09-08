'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { addWorkToShelf } from '@/features/reading-state/reading-state-api';

export function useAddToShelfMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workId: string) => addWorkToShelf(workId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shelf'] });
      await queryClient.invalidateQueries({ queryKey: ['discover'] });
    },
  });
}
