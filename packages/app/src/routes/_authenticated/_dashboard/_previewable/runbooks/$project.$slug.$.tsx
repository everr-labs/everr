import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "@/components/runbooks/runbook-not-found";
import { RunbookViewer } from "@/components/runbooks/runbook-viewer";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks/$project/$slug/$",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  head: runbookHead,
  component: RunbookSplatPage,
  notFoundComponent: RunbookNotFound,
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({
    context: { queryClient },
    params: { project, slug, _splat },
    deps: { preview },
  }) => loadRunbook(queryClient, project, slug, preview, _splat ?? ""),
});

function RunbookSplatPage() {
  const { project, slug, _splat } = Route.useParams();
  return (
    <RunbookViewer project={project} slug={slug} pagePath={_splat ?? ""} />
  );
}
