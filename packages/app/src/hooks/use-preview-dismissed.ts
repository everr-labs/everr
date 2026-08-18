import { useQuery, useQueryClient } from "@tanstack/react-query";

// Per-preview bar dismissal held in the query cache (a shared, reactive store —
// no server). Keyed by preview name so dismissing one preview's banner doesn't
// hide it for the others; Infinity stale/gc means the queryFn never runs and
// the value survives navigation within a preview.
export function usePreviewDismissed(
  preview: string,
): readonly [boolean, () => void] {
  const queryClient = useQueryClient();
  const queryKey = ["preview-frame-dismissed", preview] as const;
  const { data: dismissed } = useQuery({
    queryKey,
    queryFn: () => queryClient.getQueryData<boolean>(queryKey) ?? false,
    initialData: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const dismiss = () => queryClient.setQueryData(queryKey, true);
  return [dismissed, dismiss];
}
