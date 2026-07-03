import { useQuery, useQueryClient } from "@tanstack/react-query";

const PREVIEW_DISMISSED_KEY = ["preview-frame-dismissed"] as const;

/**
 * Global, cross-navigation dismissal for the preview bar, parked in the query
 * cache. There's no server and no fetching: `initialData` seeds it `false`,
 * `staleTime`/`gcTime` of Infinity keep it fresh and un-collected (so no
 * queryFn is ever needed and it survives leaving/returning to the previewable
 * subtree), and `dismiss()` just writes the cache. React Query gives us the
 * shared store plus reactivity without a bespoke context or external store.
 */
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
