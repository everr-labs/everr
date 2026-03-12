import {
  FilterSelect,
  type FilterSelectItem,
} from "@/components/filter-select";
import type { FilterOptions, RunLifecycleStatus } from "@/data/runs-list";

const STATUS_ITEMS: FilterSelectItem[] = [
  { value: "queued", label: "Queued" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

interface RunsFilterBarProps {
  filterOptions: FilterOptions;
  repo?: string;
  branch?: string;
  status?: RunLifecycleStatus;
  conclusion?: string;
  workflowName?: string;
  runId?: string;
  onRepoChange: (value: string | undefined) => void;
  onBranchChange: (value: string | undefined) => void;
  onStatusChange: (value: RunLifecycleStatus | undefined) => void;
  onConclusionChange: (value: string | undefined) => void;
  onWorkflowNameChange: (value: string | undefined) => void;
  onRunIdChange: (value: string) => void;
}

export function RunsFilterBar({
  filterOptions,
  repo,
  branch,
  status,
  conclusion,
  workflowName,
  runId,
  onRepoChange,
  onBranchChange,
  onStatusChange,
  onConclusionChange,
  onWorkflowNameChange,
  onRunIdChange,
}: RunsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        value={repo}
        onChange={onRepoChange}
        items={filterOptions.repos}
        placeholder="All repos"
      />

      <FilterSelect
        value={branch}
        onChange={onBranchChange}
        items={filterOptions.branches}
        placeholder="All branches"
      />

      <FilterSelect
        value={status}
        onChange={(value) => onStatusChange(value as RunLifecycleStatus)}
        items={STATUS_ITEMS}
        placeholder="All states"
      />

      <FilterSelect
        value={conclusion}
        onChange={onConclusionChange}
        items={["success", "failure", "cancellation"]}
        placeholder="All statuses"
      />

      <FilterSelect
        value={workflowName}
        onChange={onWorkflowNameChange}
        items={filterOptions.workflowNames}
        placeholder="All workflows"
      />

      <input
        type="text"
        placeholder="Search run ID..."
        value={runId || ""}
        onChange={(e) => onRunIdChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
