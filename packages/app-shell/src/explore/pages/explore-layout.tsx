import { Outlet } from "@tanstack/react-router";
import { useExploreBackend } from "../backend";

export function ExploreLayout() {
  const { Gate } = useExploreBackend();
  // Each Explore page, for example LogsExplorer or TracesExplorer, has full
  // height and scrolls itself. This column therefore has no overflow. A page in
  // the document flow that comes here must scroll itself.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {Gate ? (
        <Gate>
          <Outlet />
        </Gate>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
