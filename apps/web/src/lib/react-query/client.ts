import { QueryClient } from '@tanstack/react-query';
import { APIError } from '@/lib/api/error-handler';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (previously cacheTime)
      // 4xx 客户端错误（含 403 付费墙）不重试
      retry: (failureCount, error) => {
        if (error instanceof APIError && error.isClientError) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});
