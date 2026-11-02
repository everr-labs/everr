import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Maximize2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef } from "react";
import type { Panel } from "#app/data/dashboards/schema.ts";
import { PanelShell } from "../panel-shell";
import { useDashboardPanelData } from "./use-dashboard-panel-data";
import { useInView } from "./use-in-view";
import {
  getVisualizationInset,
  getVisualizationSpecWarnings,
  PanelVisualization,
} from "./visualizations";

/** Where a panel's maximize link goes: the dashboard page it lives on. */
export type PanelFullscreenTo =
  | { kind: "dashboard"; project: string; slug: string }
  | { kind: "builtin"; slug: string };

/**
 * The view state a panel page shares with its dashboard: the time range and
 * refresh, preview, frame flag, and variable values. The maximize link and the
 * breadcrumb back both carry exactly this, so the two pages show the same view.
 */
export interface DashboardViewSearch {
  from?: string;
  to?: string;
  refresh?: string;
  preview?: string;
  full?: boolean;
  vars?: Record<string, string | string[]>;
}

export function pickDashboardViewSearch({
  from,
  to,
  refresh,
  preview,
  full,
  vars,
}: DashboardViewSearch): DashboardViewSearch {
  return { from, to, refresh, preview, full, vars };
}

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  /** Extra header action rendered next to the spec-warnings indicator. */
  action?: ReactNode;
  /**
   * The panel page route the maximize link targets. Omitted where no such
   * page exists (runbook embeds).
   */
  fullscreenTo?: PanelFullscreenTo;
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
        <p className="mb-1 font-medium">Invalid panel options ignored (defaults used):</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The maximize affordance in the panel header: a link to the panel's own
 * page, where the shell stays and this panel fills the view. The current
 * search travels with it: `vars` is not retained across navigation (each
 * dashboard has its own variables), so the link carries the live values
 * explicitly, along with the range, preview, and frame flag.
 *
 * A raw anchor (not a `Button` with `render`): navigation is the element's
 * own semantics, and Base UI's Button would force `role="button"` onto the
 * anchor (`nativeButton={false}`) or warn about the non-button (`true`),
 * neither of which is honest for a link. The ghost icon-button styling is
 * spelled out instead, matching what `variant="ghost" size="icon-sm"` puts
 * on the FrameToggle.
 */
function MaximizeLink({
  panelKey,
  fullscreenTo,
}: {
  panelKey: string;
  fullscreenTo: PanelFullscreenTo;
}) {
  const search = pickDashboardViewSearch(useSearch({ strict: false }));
  const target =
    fullscreenTo.kind === "builtin"
      ? "/dashboards/built-in/$slug/panel/$panelKey"
      : "/dashboards/$project/$slug/panel/$panelKey";
  const params =
    fullscreenTo.kind === "builtin"
      ? { slug: fullscreenTo.slug, panelKey }
      : {
          project: fullscreenTo.project,
          slug: fullscreenTo.slug,
          panelKey,
        };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={target}
            params={params}
            search={search}
            aria-label="Open the panel full screen"
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted/50 hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            )}
          />
        }
      >
        <Maximize2 className="size-4" />
      </TooltipTrigger>
      <TooltipContent>Open full screen</TooltipContent>
    </Tooltip>
  );
}

export function DashboardPanel({ panel, panelKey, action, fullscreenTo }: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef);

  const { data, status, errorMessage, timeRange } = useDashboardPanelData(panel, {
    enabled: inView,
  });

  const specWarnings = useMemo(() => getVisualizationSpecWarnings(plugin), [plugin]);

  const handleTimeRangeChange = useCallback(
    (range: { from: Date; to: Date }) => {
      void navigate({
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

  const maximize = fullscreenTo ? (
    <MaximizeLink panelKey={panelKey} fullscreenTo={fullscreenTo} />
  ) : undefined;
  const headerAction =
    maximize || action || specWarnings.length > 0 ? (
      <div className="flex items-center gap-1.5">
        {specWarnings.length > 0 && <SpecWarningsIndicator warnings={specWarnings} />}
        {maximize}
        {action}
      </div>
    ) : undefined;

  return (
    <div ref={containerRef} className="group/panel relative h-full">
      <PanelShell
        title={display?.name ?? panelKey}
        description={display?.description}
        status={status}
        errorMessage={errorMessage}
        className="h-full"
        inset={getVisualizationInset(plugin.kind)}
        action={headerAction}
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
