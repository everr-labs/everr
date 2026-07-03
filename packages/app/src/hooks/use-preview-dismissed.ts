import { useQuery, useQueryClient } from "@tanstack/react-query";

const PREVIEW_DISMISSED_KEY = ["preview-frame-dismissed"] as const;

// Global preview-bar dismissal held in the query cache (a shared, reactive store
// — no server). Infinity stale/gc means it never fetches (so no queryFn) and
// survives navigation across the previewable subtree.
export function usePreviewDismissed(): readonly [boolean, () => void] {
  const queryClient = useQueryClient();
  const { data: dismissed } = useQuery({
    queryKey: PREVIEW_DISMISSED_KEY,
    initialData: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const dismiss = () => queryClient.setQueryData(PREVIEW_DISMISSED_KEY, true);
  return [dismissed, dismiss];
}
