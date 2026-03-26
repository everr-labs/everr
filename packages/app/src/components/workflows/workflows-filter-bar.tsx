import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";

interface WorkflowsFilterBarProps {
  repos: string[];
  repo?: string;
  search?: string;
  onRepoChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
}

export function WorkflowsFilterBar({
  repos,
  repo,
  search,
  onRepoChange,
  onSearchChange,
}: WorkflowsFilterBarProps) {
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
          {repos.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        type="text"
        placeholder="Search workflows..."
        value={search || ""}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
