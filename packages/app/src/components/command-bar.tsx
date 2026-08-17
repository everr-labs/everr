import { ConclusionIcon } from "@everr/telemetry-explorer/runs";
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
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { LayoutDashboard, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { dashboardListOptions } from "@/data/dashboards/options";
import { searchRunsOptions } from "@/data/runs-list/options";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { navGroups } from "@/lib/navigation";

export function CommandBar() {
  const navigate = useNavigate();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: runResults } = useQuery({
    ...searchRunsOptions(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
  });

  const { data: dashboardList } = useQuery(dashboardListOptions(preview));

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
        onClick={() => toggleCommandBar(true)}
        className={cn(
          // Pointless without a keyboard and eats the narrow header on phones.
          "hidden w-52 cursor-text md:inline-flex",
          open ? "opacity-0" : "opacity-100",
        )}
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
        className="transition-none"
      >
        <Command className="p-0">
          <CommandInput
            placeholder="Search..."
            value={search}
            onValueChange={setSearch}
            inputGroupClassName="h-10 border-none rounded-none"
            className="p-0"
            wrapperClassName="p-0 border-b"
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
            {dashboardList && dashboardList.length > 0 && (
              <CommandGroup heading="Dashboards">
                {dashboardList.map((d) => (
                  <CommandItem
                    key={`${d.project}/${d.slug}`}
                    value={`dashboard ${d.name} ${d.slug}`}
                    onSelect={() =>
                      handleSelect(`/dashboards/${d.project}/${d.slug}`)
                    }
                  >
                    <LayoutDashboard />
                    {d.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {navGroups.map((group) => (
              <CommandGroup
                key={group.label ?? "pinned"}
                heading={group.label ?? "Navigation"}
              >
                {group.items.map((item) => (
                  <CommandItem
                    key={item.url}
                    onSelect={() => handleSelect(item.url)}
                  >
                    <item.icon />
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
