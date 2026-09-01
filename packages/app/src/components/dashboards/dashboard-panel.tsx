import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef } from "react";
import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import { useDashboardPanelData } from "./use-dashboard-panel-data";
import { useInView } from "./use-in-view";
import {
  getVisualizationInset,
  getVisualizationSpecDeprecations,
  getVisualizationSpecWarnings,
  PanelVisualization,
} from "./visualizations";
import {
  deprecatedOptionsPrompt,
  type SpecDeprecation,
} from "./visualizations/deprecations";

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

/**
 * A deprecated option isn't a mistake to point at — it's an edit waiting to be
 * made in a file this UI can't write (ADR 0004). So this opens rather than
 * hovers: the reader needs to get the prompt out, not just read the warning.
 */
function SpecDeprecationsIndicator({
  panelName,
  deprecations,
}: {
  panelName: string;
  deprecations: SpecDeprecation[];
}) {
  const prompt = deprecatedOptionsPrompt({ panelName, deprecations });
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(prompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="text-amber-500 hover:text-amber-400"
            aria-label="Deprecated panel options"
          />
        }
      >
        <TriangleAlert className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="font-medium text-sm">Deprecated panel options</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground text-xs/relaxed">
          {deprecations.map((d) => (
            <li key={d.option}>
              <code className="font-mono text-foreground/90">{d.option}</code>:{" "}
              {d.message}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted-foreground text-xs/relaxed">
          Paste this into your coding assistant. It finds the as-code file,
          makes the edit, and ships it the way this repository delivers
          resources.
        </p>
        <div className="mt-3 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
          <code
            ref={promptRef}
            className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[0.6875rem]/relaxed text-foreground/90"
          >
            {prompt}
          </code>
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-3 w-full"
          onClick={copy}
          aria-label="Copy assistant prompt"
        >
          {copyState === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copyState === "copied" ? "Copied" : "Copy prompt"}
        </Button>
        {/* One status line serves sighted and screen-reader users alike:
            visible on failure, announced-only for the transient "copied". */}
        <p
          role="status"
          className={cn(
            "mt-2 text-amber-400 text-xs",
            copyState !== "failed" && "sr-only",
          )}
        >
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function DashboardPanel({
  panel,
  panelKey,
  action,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef);

  const { data, status, errorMessage, timeRange } = useDashboardPanelData(
    panel,
    { enabled: inView },
  );

  const specWarnings = useMemo(
    () => getVisualizationSpecWarnings(plugin),
    [plugin],
  );

  const specDeprecations = useMemo(
    () => getVisualizationSpecDeprecations(plugin),
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
    <div ref={containerRef} className="group/panel relative h-full">
      <PanelShell
        title={display?.name ?? panelKey}
        description={display?.description}
        status={status}
        errorMessage={errorMessage}
        className="h-full"
        inset={getVisualizationInset(plugin.kind)}
        action={
          action || specWarnings.length > 0 || specDeprecations.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {specWarnings.length > 0 && (
                <SpecWarningsIndicator warnings={specWarnings} />
              )}
              {specDeprecations.length > 0 && (
                <SpecDeprecationsIndicator
                  panelName={display?.name ?? panelKey}
                  deprecations={specDeprecations}
                />
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
