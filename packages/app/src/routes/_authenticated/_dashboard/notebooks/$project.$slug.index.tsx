import { createFileRoute } from "@tanstack/react-router";
import { NotebookNotFound } from "@/components/notebooks/notebook-not-found";
import { NotebookViewer } from "@/components/notebooks/notebook-viewer";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { notebookOptions } from "@/data/notebooks/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/notebooks/$project/$slug/",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Notebooks", to: "/notebooks" },
      { label: match.loaderData?.name ?? "Notebook" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Notebook" }] }),
  component: NotebookIndexPage,
  notFoundComponent: NotebookNotFound,
  loader: async ({ context: { queryClient }, params: { project, slug } }) => {
    // A missing notebook throws notFound() from the server fn (→ notFound UI);
    // any other failure propagates to the error boundary instead of being
    // masked as not-found.
    const notebook = await queryClient.ensureQueryData(
      notebookOptions(project, slug),
    );
    // Expose the notebook's duration/refreshInterval as route time defaults so
    // the time-range hooks seed the picker and panels from the first render —
    // no post-mount URL write, so panels never query the wrong window first.
    return {
      name: notebook.spec.display?.name ?? slug,
      timeDefaults: dashboardTimeDefaults(notebook.spec),
    };
  },
});

function NotebookIndexPage() {
  const { project, slug } = Route.useParams();
  return <NotebookViewer project={project} slug={slug} pagePath="" />;
}
