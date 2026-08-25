import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { lastViewedDashboard } from "@/data/dashboards/last-viewed";
import {
  dashboardListOptions,
  telemetryCapabilitiesOptions,
} from "@/data/dashboards/options";

const toBuiltin = (slug: string) =>
  redirect({
    to: "/dashboards/built-in/$slug",
    params: { slug },
    search: (prev) => prev,
    replace: true,
  });

const toDashboard = (project: string, slug: string) =>
  redirect({
    to: "/dashboards/$project/$slug",
    params: { project, slug },
    search: (prev) => prev,
    replace: true,
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/",
)({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({ meta: [{ title: "Everr - Dashboards" }] }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  // The index is never a page of its own: the layout always shows the list,
  // so landing here reopens where you were, else your first top-level
  // dashboard, else the first built-in that actually has data — the screen is
  // never blank and never an empty grid when a live one exists.
  loader: async ({ context: { queryClient, session }, deps: { preview } }) => {
    const last = lastViewedDashboard.read(session.session.activeOrganizationId);

    // A remembered built-in needs no server data to validate.
    if (last?.kind === "built-in" && getBuiltinDashboard(last.slug)) {
      throw toBuiltin(last.slug);
    }

    // Warm the probe alongside the list fetch: only the empty-list branch
    // below awaits it, and the rail issues the same query immediately anyway,
    // so a wasted prefetch costs nothing.
    void queryClient.prefetchQuery(
      telemetryCapabilitiesOptions(
        DEFAULT_TIME_RANGE.from,
        DEFAULT_TIME_RANGE.to,
      ),
    );
    const list = await queryClient.ensureQueryData(
      dashboardListOptions(preview),
    );
    const live = list.filter((d) => d.previewStatus !== "removed");

    if (
      last?.kind === "own" &&
      live.some((d) => d.project === last.project && d.slug === last.slug)
    ) {
      throw toDashboard(last.project, last.slug);
    }

    // The remembered dashboard no longer exists (deleted or removed from
    // preview). Clear the stale entry so future visits fall through to the
    // fresh default instead of hitting this dead branch every time.
    if (last?.kind === "own") {
      lastViewedDashboard.clear(session.session.activeOrganizationId);
    }

    // Only top-level dashboards qualify as the default: opening something out
    // of a folder the reader has never expanded reads as a random pick.
    const [first] = live
      .filter((d) => d.folderPath === "")
      .sort((a, b) => a.name.localeCompare(b.name));
    if (first) throw toDashboard(first.project, first.slug);

    // No dashboards of your own yet: land on the get-started page, where the
    // assistant prompt creates the first one.
    throw redirect({
      to: "/dashboards/get-started",
      search: (prev) => prev,
      replace: true,
    });
  },
  component: () => null,
});
