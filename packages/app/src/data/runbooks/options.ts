import { appQueryOptions } from "@everr/ui/lib/query-options";
import type { QueryClient } from "@tanstack/react-query";
import { findPage } from "./pages";
import { getRunbook, listRunbooks } from "./server";

const runbooksQueryKey = ["runbooks"] as const;

export const runbookOptions = (project: string, slug: string, preview?: string) =>
  appQueryOptions({
    queryKey: [...runbooksQueryKey, project, slug, preview ?? ""],
    queryFn: () => getRunbook({ data: { project, slug, preview } }),
  });

export const runbookListOptions = (preview?: string) =>
  appQueryOptions({
    queryKey: [...runbooksQueryKey, "list", preview ?? ""],
    queryFn: () => listRunbooks({ data: { preview } }),
  });

/** From the cached document, else the cached list row (which has no page titles). */
export function cachedRunbookNames(
  queryClient: QueryClient,
  project: string,
  slug: string,
  preview: string | undefined,
  pagePath: string,
): { name?: string; pageTitle?: string } {
  const runbook = queryClient.getQueryData(runbookOptions(project, slug, preview).queryKey);
  if (runbook) {
    return {
      name: runbook.document.spec.display?.name ?? slug,
      pageTitle: pagePath ? findPage(runbook.document.spec, pagePath)?.title : undefined,
    };
  }
  return {
    name: queryClient
      .getQueryData(runbookListOptions(preview).queryKey)
      ?.find((row) => row.project === project && row.slug === slug)?.name,
  };
}
