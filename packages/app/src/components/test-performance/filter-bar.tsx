import {
  testPerfBranchFilterOptions,
  testPerfRepoFilterOptions,
} from "@/data/test-performance/children";
import type { TimeRange } from "@/lib/time-range";
import { FilterCombobox } from "../filter-combobox";

interface TestPerfFilterBarProps {
  timeRange: TimeRange;
  repos: string[];
  branches: string[];
  onReposChange: (values: string[]) => void;
  onBranchesChange: (values: string[]) => void;
}

export function TestPerfFilterBar({
  timeRange,
  repos,
  branches,
  onReposChange,
  onBranchesChange,
}: TestPerfFilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterCombobox
        label="Repo"
        values={repos}
        onChange={onReposChange}
        options={testPerfRepoFilterOptions({ timeRange })}
        placeholder="All"
        searchPlaceholder="Search repos..."
      />

      <FilterCombobox
        label="Branch"
        values={branches}
        onChange={onBranchesChange}
        options={testPerfBranchFilterOptions({ timeRange })}
        placeholder="All"
        searchPlaceholder="Search branches..."
      />
    </div>
  );
}
