import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { findPage } from "./pages";
import { getRunbook, listRunbooks } from "./server";

const runbooksQueryKey = ["runbooks"] as const;

export const runbookOptions = (project: string, slug: string, preview?: string) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, project, slug, preview ?? ""],
    queryFn: () => getRunbook({ data: { project, slug, preview } }),
  });

export const runbookListOptions = (preview?: string) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, "list", preview ?? ""],
    queryFn: () => listRunbooks({ data: { preview } }),
  });

/**
 * A runbook's name, and a page's title, from whatever the cache already holds:
 * the document if the runbook was opened before, else its row in the list
 * (which knows no page titles). Undefined where neither is cached.
 */
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
