import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@everr/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { searchRunsOptions } from "@/data/runs-list/options";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatRelativeTime } from "@/lib/formatting";
import { navMain } from "@/lib/navigation";

export function CommandBar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: runResults } = useQuery({
    ...searchRunsOptions(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
  });

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  function handleSelect(url: string) {
    onOpenChange(false);
    navigate({ to: url });
  }

  const hasRunResults = runResults && runResults.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      style={{ viewTransitionName: open ? "command-bar" : undefined }}
    >
      <Command>
        <CommandInput
          placeholder="Search..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          {!hasRunResults && <CommandEmpty>No results found.</CommandEmpty>}
          {hasRunResults && (
            <CommandGroup heading="Runs" forceMount>
              {runResults.map((run) => (
                <CommandItem
                  key={run.traceId}
                  value={`run ${run.runId} ${run.workflowName} ${run.repo}`}
                  onSelect={() => handleSelect(`/runs/${run.traceId}`)}
                  forceMount
                >
                  <ConclusionIcon
                    conclusion={run.conclusion}
                    className="size-3.5"
                  />
                  <span>
                    #{run.runId} · {run.workflowName}
                  </span>
                  <CommandShortcut>
                    {formatRelativeTime(run.timestamp)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {navMain.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items?.map((item) => (
                <CommandItem
                  key={item.url}
                  onSelect={() => handleSelect(item.url)}
                >
                  {group.icon && <group.icon />}
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
