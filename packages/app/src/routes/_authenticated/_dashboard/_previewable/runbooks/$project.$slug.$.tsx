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
    context: { queryClient, session },
    params: { project, slug, _splat },
    deps: { preview },
    preload,
  }) =>
    loadRunbook({
      queryClient,
      org: session.session.activeOrganizationId,
      project,
      slug,
      preview,
      pagePath: _splat ?? "",
      preload,
    }),
});

function RunbookSplatPage() {
  const { project, slug, _splat } = Route.useParams();
  return (
    <RunbookViewer project={project} slug={slug} pagePath={_splat ?? ""} />
  );
}
