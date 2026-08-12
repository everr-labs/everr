import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ExploreSearchSchema } from "@/lib/explore-search";

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
  validateSearch: ExploreSearchSchema,
  // service/environment retain + strip is handled on the `_dashboard` layout, not
  // here. Search middlewares run leaf→root, so the `_dashboard` retain runs AFTER
  // any strip declared on this route — which re-injects a just-cleared filter from
  // the previous location. Keeping both on `_dashboard` (retain then strip) lets a
  // cleared `[]` survive retain and then get stripped as a default last of all.
  //
  // This layout holds the search params. Each page puts the Service and
  // Environment controls in its own filter rail. See ExplorePersistentFilters.
  component: ExploreLayout,
});

function ExploreLayout() {
  // Each Explore page, for example LogsExplorer or TracesExplorer, has full
  // height and scrolls itself. This column therefore has no overflow. A page in
  // the document flow that comes here must scroll itself.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}
