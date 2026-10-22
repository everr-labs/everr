import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "#app/components/runbooks/runbook-not-found.tsx";
import { RunbookViewer } from "#app/components/runbooks/runbook-viewer.tsx";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/runbooks/$project/$slug/",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  head: runbookHead,
  component: RunbookIndexPage,
  notFoundComponent: RunbookNotFound,
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({
    context: { queryClient },
    params: { project, slug },
    deps: { preview },
  }) =>
    loadRunbook({
      queryClient,
      project,
      slug,
      preview,
    }),
});

function RunbookIndexPage() {
  const { project, slug } = Route.useParams();
  return <RunbookViewer project={project} slug={slug} pagePath="" />;
}
