import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "#app/components/runbooks/runbook-not-found.tsx";
import { RunbookViewer } from "#app/components/runbooks/runbook-viewer.tsx";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/runbooks/$project/$slug/$",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  component: RunbookSplatPage,
  notFoundComponent: RunbookNotFound,
  loader: ({ context: { queryClient }, params: { project, slug, _splat }, deps: { preview } }) =>
    loadRunbook({
      queryClient,
      project,
      slug,
      preview,
      pagePath: _splat ?? "",
    }),
  head: runbookHead,
});

function RunbookSplatPage() {
  const { project, slug, _splat } = Route.useParams();
  return <RunbookViewer project={project} slug={slug} pagePath={_splat ?? ""} />;
}
