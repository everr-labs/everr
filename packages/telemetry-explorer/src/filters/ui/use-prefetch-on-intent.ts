import { type QueryFunction, type QueryKey, useQueryClient } from "@tanstack/react-query";

/**
 * Trigger props that start a dropdown's query when the pointer reaches the
 * trigger or it takes focus, so the request is underway before the click.
 * A list still fresh in the query cache is not fetched again.
 */
export function usePrefetchOnIntent<TData>(
  options: { queryKey: QueryKey; queryFn: QueryFunction<TData> } | undefined,
) {
  const queryClient = useQueryClient();
  const prefetch = () => {
    if (options)
      void queryClient.prefetchQuery({ queryKey: options.queryKey, queryFn: options.queryFn });
  };
  return { onPointerEnter: prefetch, onFocus: prefetch };
}
