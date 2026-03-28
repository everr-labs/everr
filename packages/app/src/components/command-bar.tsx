import { Button } from "@everr/ui/components/button";
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
import { Kbd } from "@everr/ui/components/kbd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { searchRunsOptions } from "@/data/runs-list/options";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatRelativeTime } from "@/lib/formatting";
import { navMain } from "@/lib/navigation";

export function CommandBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: runResults } = useQuery({
    ...searchRunsOptions(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
  });

  function handleSelect(url: string) {
    toggleCommandBar(false);
    navigate({ to: url });
  }

  const toggleCommandBar = useCallback((open: boolean) => {
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        flushSync(() => {
          if (open) {
            setSearch("");
          }
          setOpen(open);
        });
      });
    } else {
      if (open) {
        setSearch("");
      }
      setOpen(open);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandBar(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, toggleCommandBar]);

  const hasRunResults = runResults && runResults.length > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => toggleCommandBar(true)}
        style={{
          viewTransitionName: open ? undefined : "command-bar",
        }}
        className="w-52 cursor-text"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="flex-1 text-left text-muted-foreground">
          Search...
        </span>
        <Kbd>⌘+K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={toggleCommandBar}
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
    </>
  );
}
