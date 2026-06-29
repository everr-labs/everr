import { createFileRoute } from "@tanstack/react-router";
import { RunbookNotFound } from "@/components/runbooks/runbook-not-found";
import { RunbookViewer } from "@/components/runbooks/runbook-viewer";
import { loadRunbook, runbookBreadcrumb, runbookHead } from "./-runbook-route";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runbooks/$project/$slug/$",
)({
  staticData: { breadcrumb: runbookBreadcrumb },
  head: runbookHead,
  component: RunbookSplatPage,
  notFoundComponent: RunbookNotFound,
  loader: ({ context: { queryClient }, params: { project, slug } }) =>
    loadRunbook(queryClient, project, slug),
});

function RunbookSplatPage() {
  const { project, slug, _splat } = Route.useParams();
  return (
    <RunbookViewer project={project} slug={slug} pagePath={_splat ?? ""} />
  );
}
