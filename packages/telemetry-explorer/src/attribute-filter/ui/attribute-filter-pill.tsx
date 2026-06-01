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
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { attributeValuesOptions } from "../options";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import {
  ATTRIBUTE_OP_CONNECTORS,
  ATTRIBUTE_OP_LABELS,
  attributeLabel,
  opTakesValues,
} from "./attribute-meta";

const OPS: AttributeOp[] = ["in", "not_in", "exists", "missing"];

function valueSummary(values: string[]): string | null {
  if (values.length === 0) return null;
  const extra = values.length - 1;
  return extra > 0 ? `${values[0]} +${extra}` : values[0];
}

function PillEditor({
  repo,
  domain,
  timeRange,
  filter,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
}) {
  const name = attributeLabel(filter.key);
  const showValues = opTakesValues(filter.op);
  const { data: values = [], isLoading } = useQuery({
    ...attributeValuesOptions(
      repo,
      { timeRange, source: filter.source, key: filter.key },
      { domain },
    ),
    enabled: showValues,
  });

  const toggleValue = (value: string) => {
    const next = filter.values.includes(value)
      ? filter.values.filter((v) => v !== value)
      : [...filter.values, value];
    onChange({ ...filter, values: next });
  };

  return (
    <div className="flex flex-col">
      <div className="border-b px-2.5 py-2">
        <div className="truncate text-xs font-medium">{name ?? filter.key}</div>
        {name ? (
          <div className="text-muted-foreground truncate font-mono text-[10px]">
            {filter.key}
          </div>
        ) : null}
      </div>

      <div className="flex gap-1 p-1.5">
        {OPS.map((op) => (
          <button
            key={op}
            type="button"
            data-active={filter.op === op || undefined}
            aria-pressed={filter.op === op}
            onClick={() => onChange({ ...filter, op })}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-[11px] transition-colors",
              "text-muted-foreground hover:bg-muted/70",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "data-active:bg-muted data-active:text-foreground data-active:font-medium",
            )}
          >
            {ATTRIBUTE_OP_LABELS[op]}
          </button>
        ))}
      </div>

      {showValues ? (
        <Command className="*-data-[slot=command-input-wrapper]:p-0 rounded-none border-t p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search values..."
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No values."}
            </CommandEmpty>
            <CommandGroup>
              {values.map((value: string) => (
                <CommandItem
                  key={value}
                  value={value}
                  data-checked={filter.values.includes(value) || undefined}
                  onSelect={() => toggleValue(value)}
                >
                  <span className="truncate">{value}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : null}
    </div>
  );
}

export function AttributeFilterPill({
  repo,
  domain,
  timeRange,
  filter,
  onChange,
  onRemove,
  defaultOpen = false,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const name = attributeLabel(filter.key) ?? filter.key;
  const connector = ATTRIBUTE_OP_CONNECTORS[filter.op];
  const summary = opTakesValues(filter.op) ? valueSummary(filter.values) : null;

  return (
    <div className="bg-background ring-offset-background focus-within:border-ring focus-within:ring-primary flex w-full items-stretch overflow-hidden rounded-md border text-xs shadow-xs focus-within:ring-2 focus-within:ring-offset-[3px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              title={filter.key}
              className="hover:bg-muted/60 flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left outline-none transition-colors"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-medium">{name}</span>
            <span className="text-muted-foreground shrink-0">{connector}</span>
          </span>
          {opTakesValues(filter.op) ? (
            <span className="truncate">
              {summary ?? (
                <span className="text-muted-foreground/70 italic">
                  any value
                </span>
              )}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 overflow-hidden p-0">
          <PillEditor
            repo={repo}
            domain={domain}
            timeRange={timeRange}
            filter={filter}
            onChange={onChange}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${name} filter`}
        className="hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center border-l px-1.5 outline-none transition-colors"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
