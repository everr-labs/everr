import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Separator } from "@everr/ui/components/separator";
import { Switch } from "@everr/ui/components/switch";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { User } from "lucide-react";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import { runsFilterOptions } from "../data/options";
import type { RunsRepositoryLike } from "../data/repository";
import { RUN_STATUS_FILTERS, type RunStatusFilter } from "../schemas";
import { ConclusionIcon } from "./conclusion-icon";
import { RUN_CONCLUSION_META } from "./run-conclusion-meta";

export interface RunsFiltersValue {
  branches: string[];
  conclusions: RunStatusFilter[];
  workflowNames: string[];
  onlyMine: boolean;
}

export interface RunsFiltersProps {
  repo: RunsRepositoryLike;
  timeRange: TimeRange;
  value: RunsFiltersValue;
  /** Render the "Your runs" switch (the desktop CI page scopes to the user). */
  showMineFilter?: boolean;
  onChange: (patch: Partial<RunsFiltersValue>) => void;
}

export function RunsFilters({
  repo,
  timeRange,
  value,
  showMineFilter = false,
  onChange,
}: RunsFiltersProps) {
  const { branches, conclusions, workflowNames, onlyMine } = value;

  const toggleStatus = (status: RunStatusFilter) => {
    onChange({
      conclusions: conclusions.includes(status)
        ? conclusions.filter((item) => item !== status)
        : [...conclusions, status],
    });
  };

  // The available branches/workflows depend on whether we're scoped to the
  // user's runs, so the option query is keyed on `onlyMine` too.
  const baseOptions = runsFilterOptions(repo, { timeRange, onlyMine });

  // "Your runs" is owned by its dedicated switch, so it doesn't count toward
  // hasActiveFilters nor get reset by "Clear all".
  const hasActiveFilters =
    branches.length > 0 || conclusions.length > 0 || workflowNames.length > 0;

  return (
    <FilterSidebar
      label="Run filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          branches: [],
          conclusions: [],
          workflowNames: [],
        })
      }
    >
      {showMineFilter ? (
        <>
          <div className="flex h-8 w-full items-center justify-between gap-2 px-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <User className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">Your runs</span>
            </span>
            <Switch
              aria-label="Your runs"
              checked={onlyMine}
              onCheckedChange={(checked) => onChange({ onlyMine: checked })}
            />
          </div>
          <Separator />
        </>
      ) : null}

      <div className="space-y-1">
        {RUN_STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={conclusions.includes(status)}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              conclusions.includes(status) &&
                "bg-background font-medium shadow-xs ring-1 ring-border",
            )}
            onClick={() => toggleStatus(status)}
          >
            <ConclusionIcon conclusion={status} className="size-3.5" />
            <span className="truncate">
              {RUN_CONCLUSION_META[status].label}
            </span>
          </button>
        ))}
      </div>

      <Separator />

      <FilterCombobox
        label="Branch"
        values={branches}
        onChange={(next) => onChange({ branches: next })}
        options={{ ...baseOptions, select: (data) => data.branches }}
        placeholder="All branches"
        searchPlaceholder="Search branches..."
        className="w-full"
      />

      <FilterCombobox
        label="Workflow"
        values={workflowNames}
        onChange={(next) => onChange({ workflowNames: next })}
        options={{ ...baseOptions, select: (data) => data.workflowNames }}
        placeholder="All workflows"
        searchPlaceholder="Search workflows..."
        className="w-full"
      />
    </FilterSidebar>
  );
}
