import { createFileRoute, redirect } from "@tanstack/react-router";
import { BUILTIN_DASHBOARDS } from "@/data/dashboards/built-in/catalog";
import { dashboardListOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/",
)({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({ meta: [{ title: "Everr - Dashboards" }] }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  // The index is never a page of its own: the layout always shows the list, so
  // landing here opens the first dashboard — yours when you have any, the
  // first built-in otherwise — and the screen is never blank.
  loader: async ({ context: { queryClient }, deps: { preview } }) => {
    const list = await queryClient.ensureQueryData(
      dashboardListOptions(preview),
    );
    // Only top-level dashboards qualify as the default: opening something out
    // of a folder the reader has never expanded reads as a random pick.
    const [first] = [...list]
      .filter((d) => d.previewStatus !== "removed" && d.folderPath === "")
      .sort((a, b) => a.name.localeCompare(b.name));
    if (first) {
      throw redirect({
        to: "/dashboards/$project/$slug",
        params: { project: first.project, slug: first.slug },
        search: (prev) => prev,
        replace: true,
      });
    }
    const builtin = BUILTIN_DASHBOARDS[0];
    if (!builtin) return;
    throw redirect({
      to: "/dashboards/built-in/$slug",
      params: { slug: builtin.id },
      search: (prev) => prev,
      replace: true,
    });
  },
  component: () => null,
});
