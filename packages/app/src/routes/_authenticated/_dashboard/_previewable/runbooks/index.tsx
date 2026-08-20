import { createFileRoute, redirect } from "@tanstack/react-router";
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

    // Every redirect below keeps the search (the frame's `full` flag lives
    // there) and replaces, because this route is never a place to come back
    // to. Spelled out rather than wrapped: a wrapper loses the typing that
    // ties each `params` to its own `to`.
    const last = lastViewedRunbook.read(org);
    const remembered =
      last &&
      live.some((r) => r.project === last.project && r.slug === last.slug)
        ? last
        : null;
    if (remembered) {
      // The page and heading are checked against the runbook as it is now, not
      // as it was when the reader left: a runbook is edited as code, and a
      // remembered page can be gone. A runbook that vanished between the list
      // and here resolves to null and falls through to the defaults below.
      const runbook = await queryClient
        .ensureQueryData(
          runbookOptions(remembered.project, remembered.slug, preview),
        )
        // The list already vouched for this runbook, so a failure here is the
        // fetch failing, not the runbook being gone. Fall through to the
        // defaults for this visit rather than forgetting where the reader was.
        .catch(() => null);
      const page =
        remembered.page &&
        runbook &&
        findPage(runbook.document.spec, remembered.page)
          ? remembered.page
          : null;
      if (runbook && page) {
        throw redirect({
          to: "/runbooks/$project/$slug/$",
          params: {
            project: remembered.project,
            slug: remembered.slug,
            _splat: page,
          },
          hash: remembered.hash,
          search: (prev) => prev,
          replace: true,
        });
      }
      if (runbook) {
        throw redirect({
          to: "/runbooks/$project/$slug",
          params: { project: remembered.project, slug: remembered.slug },
          // A heading belongs to the page it was on: dropping that page drops
          // the heading with it, rather than carrying a fragment onto a page
          // that never had it.
          hash: remembered.page ? undefined : remembered.hash,
          search: (prev) => prev,
          replace: true,
        });
      }
    } else if (last) {
      // Remembered but not in the list: deleted, or removed from the preview.
      // Clear it so future visits fall through to the fresh default instead of
      // hitting this dead branch every time.
      lastViewedRunbook.clear(org);
    }

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
