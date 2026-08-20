import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { useMemo, useRef } from "react";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import {
  useHasVisibleVariables,
  VariableBar,
} from "@/components/dashboards/variable-bar";
import { runbookOptions } from "@/data/runbooks/options";
import {
  findPage,
  makeRunbookLinkResolver,
  pageNavTree,
  toDashboardDocument,
} from "@/data/runbooks/pages";
import { RunbookMarkdown } from "./runbook-markdown";
import { RunbookPagesNav } from "./runbook-pages-nav";
import { RunbookToc } from "./runbook-toc";

export function RunbookViewer({
  project,
  slug,
  pagePath,
}: {
  project: string;
  slug: string;
  /** "" = index page; "a/b" = nested page path from the splat. */
  pagePath: string;
}) {
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  // The runbook is immutable (gitops, read-only), so the query cache is the
  // single source of truth; the route loader has already ensured the data.
  const {
    data: { document: runbook },
  } = useSuspenseQuery(runbookOptions(project, slug, preview));
  const page = findPage(runbook.spec, pagePath);
  const tree = pageNavTree(runbook.spec);
  const proseRef = useRef<HTMLDivElement>(null);
  // Build the link resolver once per runbook: it captures the page-path set
  // and file map so each rendered link doesn't re-walk the spec tree.
  const resolveLink = useMemo(
    () => makeRunbookLinkResolver(runbook.spec),
    [runbook.spec],
  );
  // Memoize the adapted document so the DashboardProvider value is stable across
  // re-renders; a fresh object would re-render every useDashboard consumer
  // (variable bar, panel queries, panels).
  const dashboardDocument = useMemo(
    () => toDashboardDocument(runbook, project, slug),
    [runbook, project, slug],
  );
  // Bind the resolver to the current page's source file once, so RunbookMarkdown
  // gets a stable callback (a fresh closure each render would re-render anchors).
  const pageFile = page?.file;
  const resolvePageLink = useMemo(
    () => (href: string) => resolveLink(href, pageFile),
    [resolveLink, pageFile],
  );

  return (
    <DashboardProvider document={dashboardDocument}>
      <RunbookVariables />
      {tree.length > 0 && (
        <RunbookPagesNav
          project={project}
          slug={slug}
          indexTitle={runbook.spec.display?.name ?? slug}
          tree={tree}
          // Keep the requested path even when the page is missing: it matches
          // no nav entry, so nothing is marked current, rather than falling
          // back to "" and wrongly marking the index while the pane shows
          // page-not-found.
          activePath={pagePath}
        />
      )}
      {/* The reading measure is the frame's job: the pane centers this column
          (see the runbooks route layout), so nothing here caps its width. */}
      {page ? (
        <>
          <RunbookToc container={proseRef} pageKey={`${slug}/${pagePath}`} />
          <RunbookMarkdown
            markdown={page.markdown}
            project={project}
            slug={slug}
            resolveLink={resolvePageLink}
            containerRef={proseRef}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <FileQuestion className="size-10" />
          <p className="text-sm">
            This runbook has no page &ldquo;{pagePath}&rdquo;
          </p>
        </div>
      )}
    </DashboardProvider>
  );
}

/**
 * The runbook's variable pickers, on one control-height baseline like the
 * dashboard toolbar. Split out so it can read the variables from the provider
 * above it, and so nothing renders when the runbook declares none.
 */
function RunbookVariables() {
  if (!useHasVisibleVariables()) return null;
  return (
    <div className="mb-4 flex min-w-0 items-center">
      <VariableBar layout="inline" />
    </div>
  );
}
