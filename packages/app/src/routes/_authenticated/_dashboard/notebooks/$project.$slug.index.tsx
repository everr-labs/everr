import { createFileRoute } from "@tanstack/react-router";
import { NotebookNotFound } from "@/components/notebooks/notebook-not-found";
import { NotebookViewer } from "@/components/notebooks/notebook-viewer";
import {
  loadNotebook,
  notebookBreadcrumb,
  notebookHead,
} from "./-notebook-route";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/notebooks/$project/$slug/",
)({
  staticData: { breadcrumb: notebookBreadcrumb },
  head: notebookHead,
  component: NotebookIndexPage,
  notFoundComponent: NotebookNotFound,
  loader: ({ context: { queryClient }, params: { project, slug } }) =>
    loadNotebook(queryClient, project, slug),
});

function NotebookIndexPage() {
  const { project, slug } = Route.useParams();
  return <NotebookViewer project={project} slug={slug} pagePath="" />;
}
