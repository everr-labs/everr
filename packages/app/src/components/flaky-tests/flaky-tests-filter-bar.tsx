import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FlakyTestFilterOptions } from "@/data/flaky-tests";

interface FlakyTestsFilterBarProps {
  filterOptions: FlakyTestFilterOptions;
  repo?: string;
  branch?: string;
  search?: string;
  onRepoChange: (value: string | undefined) => void;
  onBranchChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
}

export function FlakyTestsFilterBar({
  filterOptions,
  repo,
  branch,
  search,
  onRepoChange,
  onBranchChange,
  onSearchChange,
}: FlakyTestsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={repo || "__all__"}
        onValueChange={(v) =>
          onRepoChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {filterOptions.repos
            .filter((r) => r !== "__all__")
            .map((r) => (
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
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {filterOptions.branches
            .filter((b) => b !== "__all__")
            .map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <input
        type="text"
        placeholder="Search test name..."
        value={search || ""}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
