import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { FilterCombobox } from "@/components/filter-combobox";
import type { FilterOptions } from "@/data/runs-list/schemas";

interface RunsFilterBarProps {
  filterOptions: FilterOptions;
  repos: string[];
  branches: string[];
  conclusions: string[];
  workflowNames: string[];
  runId?: string;
  onReposChange: (values: string[]) => void;
  onBranchesChange: (values: string[]) => void;
  onConclusionsChange: (values: string[]) => void;
  onWorkflowNamesChange: (values: string[]) => void;
  onRunIdChange: (value: string) => void;
}

export function RunsFilterBar({
  filterOptions,
  repos,
  branches,
  conclusions,
  workflowNames,
  runId,
  onReposChange,
  onBranchesChange,
  onConclusionsChange,
  onWorkflowNamesChange,
  onRunIdChange,
}: RunsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterCombobox
        label="Repo"
        values={repos}
        onChange={onReposChange}
        items={filterOptions.repos}
        placeholder="All"
        searchPlaceholder="Search repos..."
      />

      <FilterCombobox
        label="Branch"
        values={branches}
        onChange={onBranchesChange}
        items={filterOptions.branches}
        placeholder="All"
        searchPlaceholder="Search branches..."
      />

      <FilterCombobox
        label="Status"
        values={conclusions}
        onChange={onConclusionsChange}
        items={["success", "failure", "cancellation"]}
        placeholder="All"
        searchPlaceholder="Search statuses..."
      />

      <FilterCombobox
        label="Workflow"
        values={workflowNames}
        onChange={onWorkflowNamesChange}
        items={filterOptions.workflowNames}
        placeholder="All"
        searchPlaceholder="Search workflows..."
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor="run-id" className="text-muted-foreground text-xs">
          Run ID
        </Label>
        <Input
          id="run-id"
          type="text"
          placeholder="Search run ID..."
          value={runId || ""}
          onChange={(e) => onRunIdChange(e.target.value)}
          className="w-45 h-8"
        />
      </div>
    </div>
  );
}
