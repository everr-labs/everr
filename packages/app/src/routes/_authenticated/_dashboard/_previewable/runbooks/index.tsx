import { createFileRoute, redirect } from "@tanstack/react-router";
import { runbookListOptions } from "@/data/runbooks/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks/",
)({
  staticData: { breadcrumb: "Runbooks" },
  head: () => ({ meta: [{ title: "Everr - Runbooks" }] }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  // The index is never a page of its own: the layout always shows the rail, so
  // landing here opens a runbook instead of leaving the pane blank.
  loader: async ({ context: { queryClient }, deps: { preview } }) => {
    const list = await queryClient.ensureQueryData(runbookListOptions(preview));
    const live = list.filter((r) => r.previewStatus !== "removed");

    // Prefer a top-level runbook: opening something out of a folder the reader
    // has never expanded reads as a random pick. With everything in folders,
    // the first one still beats an empty state that would be a lie.
    const byName = [...live].sort((a, b) => a.name.localeCompare(b.name));
    const first = byName.find((r) => r.folderPath === "") ?? byName[0];
    if (first) {
      throw redirect({
        to: "/runbooks/$project/$slug",
        params: { project: first.project, slug: first.slug },
        search: (prev) => prev,
        replace: true,
      });
    }

    throw redirect({
      to: "/runbooks/get-started",
      search: (prev) => prev,
      replace: true,
    });
  },
  component: () => null,
});
