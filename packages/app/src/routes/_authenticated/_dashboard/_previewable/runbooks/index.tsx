import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { lastViewedRunbook } from "@/data/runbooks/last-viewed";
import { runbookListOptions, runbookOptions } from "@/data/runbooks/options";
import { findPage } from "@/data/runbooks/pages";

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
      // The page and heading are checked against the runbook as it is now, not
      // as it was when the reader left: a runbook is edited as code, and a
      // remembered page can be gone. Anything that no longer resolves is
      // dropped, so the worst a stale entry does is open the runbook's front
      // page. A runbook that vanished between the list and here throws, and
      // falls through to the defaults below.
      try {
        const { document } = await queryClient.ensureQueryData(
          runbookOptions(last.project, last.slug, preview),
        );
        const page =
          last.page && findPage(document.spec, last.page) ? last.page : null;
        throw page
          ? redirect({
              to: "/runbooks/$project/$slug/$",
              params: { project: last.project, slug: last.slug, _splat: page },
              hash: last.hash,
              search: (prev) => prev,
              replace: true,
            })
          : redirect({
              to: "/runbooks/$project/$slug",
              params: { project: last.project, slug: last.slug },
              // A heading belongs to the page it was on: dropping that page
              // drops the heading with it, rather than carrying a fragment
              // onto a page that never had it.
              hash: last.page ? undefined : last.hash,
              search: (prev) => prev,
              replace: true,
            });
      } catch (e) {
        if (isRedirect(e)) throw e;
      }
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
