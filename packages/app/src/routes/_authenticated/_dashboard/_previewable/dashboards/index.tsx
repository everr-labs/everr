import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { evaluateBuiltin } from "@/data/dashboards/built-in/capabilities";
import {
  BUILTIN_DASHBOARDS,
  getBuiltinDashboard,
} from "@/data/dashboards/built-in/catalog";
import { readLastViewed } from "@/data/dashboards/last-viewed";
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
  loader: async ({ context: { queryClient }, deps: { preview } }) => {
    const last = readLastViewed();

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

    // Only top-level dashboards qualify as the default: opening something out
    // of a folder the reader has never expanded reads as a random pick.
    const [first] = live
      .filter((d) => d.folderPath === "")
      .sort((a, b) => a.name.localeCompare(b.name));
    if (first) throw toDashboard(first.project, first.slug);

    // No dashboards of your own yet: land on a built-in that has something to
    // draw. The probe can fail; an arbitrary built-in still beats a blank pane.
    let builtin = BUILTIN_DASHBOARDS[0];
    try {
      const capabilities = await queryClient.ensureQueryData(
        telemetryCapabilitiesOptions(
          DEFAULT_TIME_RANGE.from,
          DEFAULT_TIME_RANGE.to,
        ),
      );
      builtin =
        BUILTIN_DASHBOARDS.find(
          (b) => evaluateBuiltin(b, capabilities).status === "ready",
        ) ?? builtin;
    } catch {
      // Fall through to the first built-in.
    }
    throw toBuiltin(builtin.id);
  },
  component: () => null,
});
