import { FilterSelect } from "@/components/filter-select";
import type { FilterOptions } from "@/data/runs-list/schemas";

interface RunsFilterBarProps {
  filterOptions: FilterOptions;
  repo?: string;
  branch?: string;
  conclusion?: string;
  workflowName?: string;
  runId?: string;
  onRepoChange: (value: string | undefined) => void;
  onBranchChange: (value: string | undefined) => void;
  onConclusionChange: (value: string | undefined) => void;
  onWorkflowNameChange: (value: string | undefined) => void;
  onRunIdChange: (value: string) => void;
}

export function RunsFilterBar({
  filterOptions,
  repo,
  branch,
  conclusion,
  workflowName,
  runId,
  onRepoChange,
  onBranchChange,
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
