import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FilterOptions } from "@/data/runs-list";

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
      <Select
        value={repo || "__all__"}
        onValueChange={(v) =>
          onRepoChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All repos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All repos</SelectItem>
          {filterOptions.repos.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={branch || "__all__"}
        onValueChange={(v) =>
          onBranchChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All branches" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All branches</SelectItem>
          {filterOptions.branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={conclusion || "__all__"}
        onValueChange={(v) =>
          onConclusionChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-35">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All statuses</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failure">Failure</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={workflowName || "__all__"}
        onValueChange={(v) =>
          onWorkflowNameChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-45]">
          <SelectValue placeholder="All workflows" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All workflows</SelectItem>
          {filterOptions.workflowNames.map((w) => (
            <SelectItem key={w} value={w}>
              {w}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
