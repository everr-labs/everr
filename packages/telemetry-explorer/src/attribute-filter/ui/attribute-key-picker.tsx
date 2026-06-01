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
import { attributeKeysOptions } from "../options";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeKey, AttributeSource } from "../schemas";
import {
  ATTRIBUTE_SOURCE_LABELS,
  attributeLabel,
  type PromotedAttribute,
} from "./attribute-meta";

const filterKey = (source: AttributeSource, key: string) => `${source}:${key}`;

export function AttributeKeyPicker({
  repo,
  domain,
  timeRange,
  activeKeys,
  promotedAttributes,
  excludedKeys,
  sources,
  onSelect,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  // Keys (`source:key`) already in use, hidden from the menu.
  activeKeys?: ReadonlySet<string>;
  promotedAttributes: PromotedAttribute[];
  // Keys (`source:key`) surfaced by a dedicated top-level filter, hidden here.
  excludedKeys: ReadonlySet<string>;
  sources: AttributeSource[];
  onSelect: (key: { source: AttributeSource; key: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: keys = [], isLoading } = useQuery({
    ...attributeKeysOptions(repo, { timeRange }, { domain }),
    enabled: open,
  });

  const promotedKeySet = new Set(
    promotedAttributes.map((p) => filterKey(p.source, p.key)),
  );

  const isActive = (source: AttributeSource, key: string) =>
    activeKeys?.has(filterKey(source, key)) ?? false;

  const choose = (source: AttributeSource, key: string) => {
    onSelect({ source, key });
    setOpen(false);
  };

  const renderItem = (source: AttributeSource, key: string) => {
    const label = attributeLabel(key);
    return (
      <CommandItem
        key={filterKey(source, key)}
        value={`${source} ${label ?? ""} ${key}`}
        onSelect={() => choose(source, key)}
      >
        {label ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{label}</span>
            <span className="text-muted-foreground truncate font-mono text-[10px]">
              {key}
            </span>
          </span>
        ) : (
          <span className="truncate font-mono">{key}</span>
        )}
      </CommandItem>
    );
  };

  // Promoted keys are only suggested when they actually appear in the current
  // range — otherwise we'd offer a chip that can never narrow these rows and
  // hide the empty state behind it.
  const discoveredKeySet = new Set(
    keys.map((k: AttributeKey) => filterKey(k.source, k.key)),
  );

  const suggested = promotedAttributes.filter(
    (p) =>
      !isActive(p.source, p.key) &&
      discoveredKeySet.has(filterKey(p.source, p.key)),
  );

  const grouped = sources.map((source) => ({
    source,
    keys: keys.filter(
      (k: AttributeKey) =>
        k.source === source &&
        !isActive(k.source, k.key) &&
        !promotedKeySet.has(filterKey(k.source, k.key)) &&
        !excludedKeys.has(filterKey(k.source, k.key)),
    ),
  }));

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
        Filter
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
            {suggested.length > 0 && (
              <CommandGroup heading="Suggested">
                {suggested.map((p) => renderItem(p.source, p.key))}
              </CommandGroup>
            )}
            {grouped.map(
              (group) =>
                group.keys.length > 0 && (
                  <CommandGroup
                    key={group.source}
                    heading={ATTRIBUTE_SOURCE_LABELS[group.source]}
                  >
                    {group.keys.map((item: AttributeKey) =>
                      renderItem(item.source, item.key),
                    )}
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
