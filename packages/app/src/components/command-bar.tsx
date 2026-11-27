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
import { RelativeTime } from "@everr/ui/components/relative-time";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { LayoutDashboard, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BUILTIN_MANIFEST } from "#app/data/dashboards/built-in/manifest.ts";
import { dashboardListOptions } from "#app/data/dashboards/options.ts";
import { searchRunsOptions } from "#app/data/runs-list/options.ts";
import { useDebouncedValue } from "#app/hooks/use-debounced-value.ts";
import { navGroups } from "#app/lib/navigation.ts";

export function CommandBar() {
  const navigate = useNavigate();
  const { preview } = useSearch({
    from: "/_authenticated/_organization/_dashboard",
  });
  const [open, setOpen] = useState(false);
  // Keyboard opens and closes (⌘K, Escape) skip the animation: a shortcut used
  // dozens of times a day should act at once. Clicks animate.
  const [instant, setInstant] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: runResults } = useQuery({
    ...searchRunsOptions(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
  });

  const { data: dashboardList } = useQuery(dashboardListOptions(preview));

  const toggleCommandBar = useCallback((open: boolean, animate = true) => {
    if (open) {
      setSearch("");
    }
    setInstant(!animate);
    setOpen(open);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandBar(!open, false);
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
        // Pointless without a keyboard and eats the narrow header on phones.
        className="hidden w-52 cursor-text md:inline-flex"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="flex-1 text-left text-muted-foreground">Search...</span>
        <Kbd>⌘+K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(next, details) => toggleCommandBar(next, details.reason !== "escape-key")}
        className={instant ? "transition-none" : undefined}
        overlayClassName={instant ? "transition-none" : undefined}
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
                    onSelect={() => {
                      toggleCommandBar(false);
                      void navigate({
                        to: "/runs/$traceId",
                        params: { traceId: run.traceId },
                      });
                    }}
                    forceMount
                  >
                    <ConclusionIcon conclusion={run.conclusion} className="size-3.5" />
                    <span>
                      #{run.runId} · {run.workflowName}
                    </span>
                    <CommandShortcut>
                      <RelativeTime timestamp={run.timestamp} />
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
                    onSelect={() => {
                      toggleCommandBar(false);
                      void navigate({
                        to: "/dashboards/$project/$slug",
                        params: { project: d.project, slug: d.slug },
                      });
                    }}
                  >
                    <LayoutDashboard />
                    {d.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Built-in dashboards">
              {BUILTIN_MANIFEST.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`built-in dashboard ${b.name} ${b.id}`}
                  onSelect={() => {
                    toggleCommandBar(false);
                    void navigate({
                      to: "/dashboards/built-in/$slug",
                      params: { slug: b.id },
                    });
                  }}
                >
                  <LayoutDashboard />
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {navGroups.map((group) => (
              <CommandGroup
                key={group.label ?? "pinned"}
                heading={group.label ?? "Navigation"}
                className={group.accent}
              >
                {group.items.map((item) => (
                  <CommandItem
                    key={item.url}
                    className="*:[svg]:text-(--nav-accent)/75 data-[selected=true]:*:[svg]:text-(--nav-accent)"
                    onSelect={() => {
                      toggleCommandBar(false);
                      void navigate({ to: item.url });
                    }}
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
