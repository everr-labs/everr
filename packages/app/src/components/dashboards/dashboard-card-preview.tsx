import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { dashboardOptions } from "@/data/dashboards/options";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardProvider } from "./use-dashboard";
import { usePreviewViewport } from "./use-preview-viewport";

// The dashboard renders at this virtual width, then scales to the card. RGL's
// useContainerWidth reads offsetWidth (transform-agnostic), so the layout is
// computed at full width and only visually shrunk.
const PREVIEW_WIDTH = 1280;

export function DashboardCardPreview({
  project,
  slug,
}: {
  project: string;
  slug: string;
}) {
  const { ref, inView, width } = usePreviewViewport<HTMLDivElement>();
  const { data: doc } = useQuery({
    ...dashboardOptions(project, slug),
    enabled: inView,
  });
  const scale = width > 0 ? width / PREVIEW_WIDTH : 0;

  return (
    <div ref={ref} className="relative size-full overflow-hidden">
      {doc && scale > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: PREVIEW_WIDTH, transform: `scale(${scale})` }}
        >
          <DashboardProvider document={doc}>
            <DashboardGrid preview />
          </DashboardProvider>
        </div>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </div>
  );
}
