import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestPerfFilterOptions } from "@/data/test-performance";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface TestPerfFilterBarProps {
  filterOptions: TestPerfFilterOptions;
  repo?: string;
  testName?: string;
  branch?: string;
  onRepoChange: (value: string | undefined) => void;
  onTestNameChange: (value: string) => void;
  onBranchChange: (value: string | undefined) => void;
}

export function TestPerfFilterBar({
  filterOptions,
  repo,
  testName,
  branch,
  onRepoChange,
  onTestNameChange,
  onBranchChange,
}: TestPerfFilterBarProps) {
  const [localTestName, setLocalTestName] = useState(testName || "");
  const debouncedTestName = useDebouncedValue(localTestName, 300);

  // Sync debounced value to parent
  useEffect(() => {
    onTestNameChange(debouncedTestName);
  }, [debouncedTestName, onTestNameChange]);

  // Sync external changes (e.g. URL navigation) back to local state
  useEffect(() => {
    setLocalTestName(testName || "");
  }, [testName]);

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
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
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
        value={localTestName}
        onChange={(e) => setLocalTestName(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
