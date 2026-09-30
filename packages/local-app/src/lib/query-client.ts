import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchInterval: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
