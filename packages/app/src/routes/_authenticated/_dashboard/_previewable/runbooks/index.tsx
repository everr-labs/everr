import { createFileRoute, redirect } from "@tanstack/react-router";
import { lastViewedRunbook } from "@/data/runbooks/last-viewed";
import { runbookListOptions } from "@/data/runbooks/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks/",
)({
  staticData: { breadcrumb: "Runbooks" },
  head: () => ({ meta: [{ title: "Everr - Runbooks" }] }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  // The index is never a page of its own: the layout always shows the rail, so
  // landing here opens a runbook instead of leaving the pane blank.
  loader: async ({ context: { queryClient, session }, deps: { preview } }) => {
    const org = session.session.activeOrganizationId;
    const list = await queryClient.ensureQueryData(runbookListOptions(preview));
    const live = list.filter((r) => r.previewStatus !== "removed");

    const open = (r: { project: string; slug: string }) =>
      redirect({
        to: "/runbooks/$project/$slug",
        params: { project: r.project, slug: r.slug },
        search: (prev) => prev,
        replace: true,
      });

    const last = lastViewedRunbook.read(org);
    if (
      last &&
      live.some((r) => r.project === last.project && r.slug === last.slug)
    ) {
      throw open(last);
    }
    // The remembered runbook no longer exists (deleted, or removed from the
    // preview). Clear the stale entry so future visits fall through to the
    // fresh default instead of hitting this dead branch every time.
    if (last) lastViewedRunbook.clear(org);

    // Prefer a top-level runbook: opening something out of a folder the reader
    // has never expanded reads as a random pick. With everything in folders,
    // the first one still beats an empty state that would be a lie.
    const byName = [...live].sort((a, b) => a.name.localeCompare(b.name));
    const first = byName.find((r) => r.folderPath === "") ?? byName[0];
    if (first) throw open(first);

    throw redirect({
      to: "/runbooks/get-started",
      search: (prev) => prev,
      replace: true,
    });
  },
  component: () => null,
});
