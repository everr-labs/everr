import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { useMemo } from "react";
import { FrameToggle } from "@/components/dashboards/frame-toggle";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import {
  useHasVisibleVariables,
  VariableBar,
} from "@/components/dashboards/variable-bar";
import { runbookOptions } from "@/data/runbooks/options";
import {
  findPage,
  makeRunbookLinkResolver,
  toDashboardDocument,
} from "@/data/runbooks/pages";
import { RunbookMarkdown } from "./runbook-markdown";

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
      <RunbookToolbar />
      {/* The reading measure is the pane's job; the toolbar spans the pane. */}
      <div className="min-w-0 max-w-4xl">
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
    </DashboardProvider>
  );
}

/**
 * The same toolbar row the dashboard grid uses: the frame toggle first, then
 * the runbook's variable pickers on one control-height baseline. Split out so
 * it can read the variables from the provider above it.
 */
function RunbookToolbar() {
  const hasVariables = useHasVisibleVariables();
  return (
    <div className="mb-3 flex items-start gap-x-3">
      <div className="flex h-8 shrink-0 items-center">
        <FrameToggle listLabel="runbook list" />
      </div>
      {hasVariables && (
        <div aria-hidden className="flex h-8 items-center">
          <div className="h-5 w-px bg-border" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <VariableBar layout="inline" />
      </div>
    </div>
  );
}
