import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { logAttributeKeysOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeSource, LogAttributeKey } from "../schemas";
import { ATTRIBUTE_SOURCE_LABELS, attributeLabel } from "./attribute-meta";

export function AttributeKeyPicker({
  repo,
  timeRange,
  onSelect,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  onSelect: (key: { source: AttributeSource; key: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: keys = [], isLoading } = useQuery({
    ...logAttributeKeysOptions(repo, { timeRange }),
    enabled: open,
  });

  const grouped = (["resource", "log", "scope"] as AttributeSource[]).map(
    (source) => ({
      source,
      keys: keys.filter((k: LogAttributeKey) => k.source === source),
    }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start"
          />
        }
      >
        <Plus className="size-3.5" />
        Add filter
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popper-anchor-width) min-w-56 p-0"
      >
        <Command className="p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search attributes..."
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No attributes."}
            </CommandEmpty>
            {grouped.map(
              (group) =>
                group.keys.length > 0 && (
                  <CommandGroup
                    key={group.source}
                    heading={ATTRIBUTE_SOURCE_LABELS[group.source]}
                  >
                    {group.keys.map((item: LogAttributeKey) => {
                      const label = attributeLabel(item.key);
                      return (
                        <CommandItem
                          key={`${item.source}:${item.key}`}
                          value={`${group.source} ${label ?? ""} ${item.key}`}
                          onSelect={() => {
                            onSelect({ source: item.source, key: item.key });
                            setOpen(false);
                          }}
                        >
                          {label ? (
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">{label}</span>
                              <span className="text-muted-foreground truncate font-mono text-[10px]">
                                {item.key}
                              </span>
                            </span>
                          ) : (
                            <span className="truncate font-mono">
                              {item.key}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ),
            )}
            {keys.length >= 500 && (
              <div className="text-muted-foreground px-2 py-1 text-xs">
                Showing first 500 attributes
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
