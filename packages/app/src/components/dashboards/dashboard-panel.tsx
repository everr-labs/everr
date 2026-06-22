import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import { useDashboardPanelData } from "./use-dashboard-panel-data";
import {
  getVisualizationInset,
  getVisualizationSpecWarnings,
  PanelVisualization,
} from "./visualizations";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  /** Extra header action rendered next to the spec-warnings indicator. */
  action?: ReactNode;
}

function SpecWarningsIndicator({ warnings }: { warnings: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="text-amber-500 hover:text-amber-400"
            aria-label="Invalid panel options"
          />
        }
      >
        <TriangleAlert className="size-4" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <p className="mb-1 font-medium">
          Invalid panel options ignored (defaults used):
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function DashboardPanel({
  panel,
  panelKey,
  action,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();

  const { data, status, errorMessage, timeRange } =
    useDashboardPanelData(panel);

  const specWarnings = useMemo(
    () => getVisualizationSpecWarnings(plugin),
    [plugin],
  );

  const handleTimeRangeChange = useCallback(
    (range: { from: Date; to: Date }) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        }),
        replace: false,
      });
    },
    [navigate],
  );

  return (
    <div className="group/panel relative h-full">
      <PanelShell
        title={display?.name ?? panelKey}
        description={display?.description}
        status={status}
        errorMessage={errorMessage}
        className="h-full"
        inset={getVisualizationInset(plugin.kind)}
        action={
          action || specWarnings.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {specWarnings.length > 0 && (
                <SpecWarningsIndicator warnings={specWarnings} />
              )}
              {action}
            </div>
          ) : undefined
        }
      >
        <PanelVisualization
          plugin={plugin}
          data={data}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </PanelShell>
    </div>
  );
}
