import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestPerfFilterOptions } from "@/data/test-performance";

interface TestPerfFilterBarProps {
  filterOptions: TestPerfFilterOptions;
  packages: string[];
  repo?: string;
  pkg?: string;
  testName?: string;
  branch?: string;
  onRepoChange: (value: string | undefined) => void;
  onPackageChange: (value: string | undefined) => void;
  onTestNameChange: (value: string) => void;
  onBranchChange: (value: string | undefined) => void;
}

export function TestPerfFilterBar({
  filterOptions,
  packages,
  repo,
  pkg,
  testName,
  branch,
  onRepoChange,
  onPackageChange,
  onTestNameChange,
  onBranchChange,
}: TestPerfFilterBarProps) {
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
        value={pkg || "__all__"}
        onValueChange={(v) =>
          onPackageChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All packages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All packages</SelectItem>
          {packages.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
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
          <SelectItem value="main">main only</SelectItem>
          {filterOptions.branches
            .filter((b) => b !== "main")
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
        value={testName || ""}
        onChange={(e) => onTestNameChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
