import { FilterSidebar } from "@everr/telemetry-explorer/filters";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Separator } from "@everr/ui/components/separator";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import {
  runBranchFilterOptions,
  runRepoFilterOptions,
  runWorkflowNameFilterOptions,
} from "@/data/runs-list/options";
import {
  RUN_CONCLUSION_META,
  RUN_STATUS_FILTERS,
  type RunStatusFilter,
} from "./run-conclusion-meta";

export interface RunsFiltersValue {
  repos: string[];
  branches: string[];
  conclusions: RunStatusFilter[];
  workflowNames: string[];
}

export interface RunsFiltersProps {
  timeRange: TimeRange;
  value: RunsFiltersValue;
  onChange: (patch: Partial<RunsFiltersValue>) => void;
}

export function RunsFilters({ timeRange, value, onChange }: RunsFiltersProps) {
  const { repos, branches, conclusions, workflowNames } = value;

  const toggleStatus = (status: RunStatusFilter) => {
    onChange({
      conclusions: conclusions.includes(status)
        ? conclusions.filter((item) => item !== status)
        : [...conclusions, status],
    });
  };

  const hasActiveFilters =
    repos.length > 0 ||
    branches.length > 0 ||
    conclusions.length > 0 ||
    workflowNames.length > 0;

  return (
    <FilterSidebar
      label="Run filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          repos: [],
          branches: [],
          conclusions: [],
          workflowNames: [],
        })
      }
    >
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
        label="Repository"
        values={repos}
        onChange={(next) => onChange({ repos: next })}
        options={runRepoFilterOptions({ timeRange })}
        placeholder="All repositories"
        searchPlaceholder="Search repos..."
        className="w-full"
      />

      <FilterCombobox
        label="Branch"
        values={branches}
        onChange={(next) => onChange({ branches: next })}
        options={runBranchFilterOptions({ timeRange })}
        placeholder="All branches"
        searchPlaceholder="Search branches..."
        className="w-full"
      />

      <FilterCombobox
        label="Workflow"
        values={workflowNames}
        onChange={(next) => onChange({ workflowNames: next })}
        options={runWorkflowNameFilterOptions({ timeRange })}
        placeholder="All workflows"
        searchPlaceholder="Search workflows..."
        className="w-full"
      />
    </FilterSidebar>
  );
}
