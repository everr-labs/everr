import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "better-themes";
import { type LucideIcon, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { searchRunsOptions } from "@/data/runs-list";
import { formatRelativeTime } from "@/lib/formatting";
import { navMain } from "@/lib/navigation";

const themeIcons: Record<string, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

import { useDebouncedValue } from "@/hooks/use-debounced-value";

type Page = "root" | "theme";

export function CommandBar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { theme, setTheme, themes } = useTheme();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<Page>("root");
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: runResults } = useQuery({
    ...searchRunsOptions(debouncedSearch),
    enabled: page === "root" && debouncedSearch.length >= 2,
  });

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setPage("root");
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
      <Command
        onKeyDown={(e) => {
          if (page !== "root" && e.key === "Backspace" && !search) {
            e.preventDefault();
            setPage("root");
          }
        }}
      >
        <CommandInput
          placeholder={page === "theme" ? "Select theme..." : "Search..."}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          {page === "root" && (
            <>
              {!hasRunResults && <CommandEmpty>No results found.</CommandEmpty>}
              {hasRunResults && (
                <CommandGroup heading="Runs" forceMount>
                  {runResults.map((run) => (
                    <CommandItem
                      key={run.traceId}
                      value={`run ${run.runId} ${run.workflowName} ${run.repo}`}
                      onSelect={() =>
                        handleSelect(`/dashboard/runs/${run.traceId}`)
                      }
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
              <CommandGroup heading="Settings">
                <CommandItem
                  onSelect={() => {
                    setPage("theme");
                    setSearch("");
                  }}
                >
                  <Palette />
                  Change Theme
                </CommandItem>
              </CommandGroup>
            </>
          )}
          {page === "theme" && (
            <>
              <CommandEmpty>No matching theme.</CommandEmpty>
              <CommandGroup heading="Theme">
                {themes.map((value) => {
                  const Icon = themeIcons[value] ?? Monitor;
                  return (
                    <CommandItem
                      key={value}
                      data-checked={theme === value}
                      onSelect={() => {
                        setTheme(value);
                        onOpenChange(false);
                      }}
                    >
                      <Icon />
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
