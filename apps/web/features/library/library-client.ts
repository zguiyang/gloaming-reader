'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { addToLibrary, libraryQueryKey } from '@/features/library/library-api';

export function useAddToLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addToLibrary,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      await queryClient.invalidateQueries({ queryKey: ['discover'] });
      await queryClient.invalidateQueries({ queryKey: ['book-detail'] });
    },
  });
}
