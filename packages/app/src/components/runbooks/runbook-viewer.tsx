import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { useMemo } from "react";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { VariableBar } from "@/components/dashboards/variable-bar";
import { PreviewBanner } from "@/components/preview-banner";
import { runbookOptions } from "@/data/runbooks/options";
import {
  findPage,
  makeRunbookLinkResolver,
  pageNavTree,
  toDashboardDocument,
} from "@/data/runbooks/pages";
import { RunbookMarkdown } from "./runbook-markdown";
import { RunbookPageNav } from "./runbook-page-nav";

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
    data: { document: runbook, previewStatus },
  } = useSuspenseQuery(runbookOptions(project, slug, preview));
  const page = findPage(runbook.spec, pagePath);
  const tree = pageNavTree(runbook.spec);
  const indexTitle = runbook.spec.display?.name ?? slug;
  // Build the link resolver once per runbook — it captures the page-path set
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
      {previewStatus ? (
        <div className="mb-4">
          <PreviewBanner preview={preview} status={previewStatus} />
        </div>
      ) : null}
      <div className="flex gap-6">
        {tree.length > 0 && (
          <RunbookPageNav
            project={project}
            slug={slug}
            indexTitle={indexTitle}
            tree={tree}
            // Keep the requested path even when the page is missing: it matches
            // no nav node, so nothing is highlighted — rather than falling back
            // to "" and wrongly highlighting the index while the pane shows
            // page-not-found.
            activePath={pagePath}
          />
        )}
        <div className="min-w-0 max-w-4xl flex-1">
          <VariableBar />
          {page ? (
            <RunbookMarkdown
              markdown={page.markdown}
              project={project}
              slug={slug}
              resolveLink={resolvePageLink}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <FileQuestion className="size-10" />
              <p className="text-sm">
                This runbook has no page &ldquo;{pagePath}&rdquo;
              </p>
            </div>
          )}
        </div>
      </div>
    </DashboardProvider>
  );
}
