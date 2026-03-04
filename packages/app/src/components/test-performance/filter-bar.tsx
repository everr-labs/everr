import type { TestPerfFilterOptions } from "@/data/test-performance";
import { FilterSelect } from "../filter-select";

interface TestPerfFilterBarProps {
  filterOptions: TestPerfFilterOptions;
  repo?: string;
  branch?: string;
  onRepoChange: (value: string | undefined) => void;
  onBranchChange: (value: string | undefined) => void;
}

export function TestPerfFilterBar({
  filterOptions,
  repo,
  branch,
  onRepoChange,
  onBranchChange,
}: TestPerfFilterBarProps) {
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
    </div>
  );
}
