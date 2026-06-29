import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "@/components/runbooks/runbook-not-found";
import { RunbookViewer } from "@/components/runbooks/runbook-viewer";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runbooks/$project/$slug/",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  head: runbookHead,
  component: RunbookIndexPage,
  notFoundComponent: RunbookNotFound,
  loader: ({ context: { queryClient }, params: { project, slug } }) =>
    loadRunbook(queryClient, project, slug),
});

function RunbookIndexPage() {
  const { project, slug } = Route.useParams();
  return <RunbookViewer project={project} slug={slug} pagePath="" />;
}
