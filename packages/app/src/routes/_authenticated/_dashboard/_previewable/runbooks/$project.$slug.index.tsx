import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "@/components/runbooks/runbook-not-found";
import { RunbookViewer } from "@/components/runbooks/runbook-viewer";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks/$project/$slug/",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  component: RunbookIndexPage,
  notFoundComponent: RunbookNotFound,
  loader: ({ context: { queryClient }, params: { project, slug }, deps: { preview } }) =>
    loadRunbook(queryClient, project, slug, preview),
  head: runbookHead,
});

function RunbookIndexPage() {
  const { project, slug } = Route.useParams();
  return <RunbookViewer project={project} slug={slug} pagePath="" />;
}
