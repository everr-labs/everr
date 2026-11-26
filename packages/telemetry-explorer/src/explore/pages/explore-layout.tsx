import { Outlet } from "@tanstack/react-router";
import { FilterOptionsCacheProvider } from "../../filters/data/filter-options-cache";
import { useExploreBackend } from "../backend";

const useNoFilterOptionsCache = () => undefined;

export function ExploreLayout() {
  const { Gate, useFilterOptionsCache = useNoFilterOptionsCache } = useExploreBackend();
  const filterOptionsCache = useFilterOptionsCache();
  // Each Explore page, for example LogsExplorer or TracesExplorer, has full
  // height and scrolls itself. This column therefore has no overflow. A page in
  // the document flow that comes here must scroll itself.
  return (
    <FilterOptionsCacheProvider value={filterOptionsCache}>
      <div className="flex min-h-0 flex-1 flex-col">
        {Gate ? (
          <Gate>
            <Outlet />
          </Gate>
        ) : (
          <Outlet />
        )}
      </div>
    </FilterOptionsCacheProvider>
  );
}
