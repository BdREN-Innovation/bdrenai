import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

const MAX_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < MAX_RETRIES,
      },
      mutations: { retry: false },
    },
  });
}
