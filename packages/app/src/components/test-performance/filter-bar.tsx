import type { TestPerfFilterOptions } from "@/data/test-performance/children";
import { FilterCombobox } from "../filter-combobox";

interface TestPerfFilterBarProps {
  filterOptions: TestPerfFilterOptions;
  repos: string[];
  branches: string[];
  onReposChange: (values: string[]) => void;
  onBranchesChange: (values: string[]) => void;
}

export function TestPerfFilterBar({
  filterOptions,
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
    </div>
  );
}
