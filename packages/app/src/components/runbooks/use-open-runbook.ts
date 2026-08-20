import { useQuery } from "@tanstack/react-query";
import { useMatchRoute } from "@tanstack/react-router";
import { runbookOptions } from "@/data/runbooks/options";
import { type PageNavNode, pageNavTree } from "@/data/runbooks/pages";

export interface OpenRunbook {
  project: string;
  slug: string;
  /** "" = the runbook's own index page. */
  path: string;
}

/** Which runbook the route is on, and which of its pages. */
export function useOpenRunbook(): OpenRunbook | undefined {
  const matchRoute = useMatchRoute();
  const page = matchRoute({ to: "/runbooks/$project/$slug/$" });
  if (page)
    return { project: page.project, slug: page.slug, path: page._splat ?? "" };
  const index = matchRoute({ to: "/runbooks/$project/$slug" });
  if (index) return { project: index.project, slug: index.slug, path: "" };
  return undefined;
}

export interface OpenRunbookPages {
  indexTitle: string;
  tree: PageNavNode[];
}

/**
 * The page tree of the open runbook, or null while nothing is open, the
 * runbook has not arrived, or it is a single page.
 *
 * The route loader has already put the runbook in the cache, so this reads it
 * rather than fetching: the frame around the runbook must never suspend.
 */
export function useOpenRunbookPages(
  open: OpenRunbook | undefined,
  preview?: string,
): OpenRunbookPages | null {
  const { data } = useQuery({
    ...runbookOptions(open?.project ?? "", open?.slug ?? "", preview),
    enabled: open !== undefined,
  });
  if (!open || !data) return null;
  const tree = pageNavTree(data.document.spec);
  if (tree.length === 0) return null;
  return {
    indexTitle: data.document.spec.display?.name ?? open.slug,
    tree,
  };
}
