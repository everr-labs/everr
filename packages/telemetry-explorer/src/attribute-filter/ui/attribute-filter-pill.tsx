import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Input } from "@everr/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { attributeValuesOptions } from "../options";
import type { AttributeRepositoryLike } from "../repository";
import { type AttributeFilter, type AttributeOp, AttributeOpSchema } from "../schemas";
import {
  ATTRIBUTE_OP_CONNECTORS,
  ATTRIBUTE_OP_GROUPS,
  ATTRIBUTE_OP_LABELS,
  attributeLabel,
  opIsNumeric,
  opTakesOneValue,
  opTakesValues,
} from "./attribute-meta";

function valueSummary(values: string[]): string | null {
  if (values.length === 0) return null;
  const extra = values.length - 1;
  return extra > 0 ? `${values[0]} +${extra}` : values[0];
}

function OperatorMenu({ op, onChange }: { op: AttributeOp; onChange: (op: AttributeOp) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Operator"
        className={cn(
          "flex h-7 w-full items-center justify-between gap-1 rounded border px-2 text-[11px] font-medium",
          "hover:bg-muted/70 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {ATTRIBUTE_OP_LABELS[op]}
        <ChevronDown className="text-muted-foreground size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44">
        <DropdownMenuRadioGroup
          value={op}
          onValueChange={(next: unknown) => {
            const parsed = AttributeOpSchema.safeParse(next);
            if (parsed.success) onChange(parsed.data);
          }}
        >
          {ATTRIBUTE_OP_GROUPS.map((group, index) => (
            <Fragment key={group.label}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.ops.map((candidate) => (
                  <DropdownMenuRadioItem key={candidate} value={candidate} closeOnClick>
                    {ATTRIBUTE_OP_LABELS[candidate]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The value of a text or number operator. It applies on Enter or when the
// field loses focus, so typing does not run a query per keystroke.
function OneValueInput({
  op,
  value,
  onCommit,
}: {
  op: AttributeOp;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const numeric = opIsNumeric(op);
  const invalid = numeric && draft.trim() !== "" && !Number.isFinite(Number(draft));
  const commit = () => {
    if (!invalid && draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <div className="flex flex-col gap-1 border-t p-1.5">
      <Input
        aria-label="Value"
        aria-invalid={invalid || undefined}
        inputMode={numeric ? "decimal" : undefined}
        placeholder={numeric ? "A number" : op === "matches" ? "A regular expression" : "Text"}
        className="h-7 text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {invalid ? <span className="text-destructive text-[11px]">Enter a number.</span> : null}
    </div>
  );
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
  const showOneValue = opTakesOneValue(filter.op);

  // Debounce the search box so each keystroke doesn't fire a query; the
  // matching slice is fetched server-side so values past the discovery cutoff
  // stay reachable.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const { data: values = [], isFetching } = useQuery({
    ...attributeValuesOptions(
      repo,
      {
        timeRange,
        source: filter.source,
        key: filter.key,
        search: debouncedSearch || undefined,
      },
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

  // Always keep selected values visible, even when the current search page
  // doesn't include them, so they stay deselectable.
  const selectedMissing = filter.values.filter((v) => !values.includes(v));
  const displayValues = [...selectedMissing, ...values];

  // Let the user commit a known value that's past the discovery cutoff.
  const trimmedSearch = search.trim();
  const canAddExact = trimmedSearch.length > 0 && !displayValues.includes(trimmedSearch);

  return (
    <div className="flex flex-col">
      <div className="border-b px-2.5 py-2">
        <div className="truncate text-xs font-medium">{name ?? filter.key}</div>
        {name ? (
          <div className="text-muted-foreground truncate font-mono text-[10px]">{filter.key}</div>
        ) : null}
      </div>

      <div className="p-1.5">
        <OperatorMenu
          op={filter.op}
          // A single-value operator keeps the first value; a list keeps them all.
          onChange={(op) =>
            onChange({
              ...filter,
              op,
              values: opTakesOneValue(op) ? filter.values.slice(0, 1) : filter.values,
            })
          }
        />
      </div>

      {showOneValue ? (
        <OneValueInput
          // A new operator starts its own draft.
          key={filter.op}
          op={filter.op}
          value={filter.values[0] ?? ""}
          onCommit={(value) => onChange({ ...filter, values: value ? [value] : [] })}
        />
      ) : null}

      {showValues ? (
        <Command
          shouldFilter={false}
          className="*-data-[slot=command-input-wrapper]:p-0 rounded-none border-t p-0"
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search values..."
          />
          <CommandList>
            <CommandEmpty>{isFetching ? "Loading..." : "No values."}</CommandEmpty>
            {canAddExact ? (
              <CommandGroup>
                <CommandItem
                  value={`__exact__:${trimmedSearch}`}
                  onSelect={() => toggleValue(trimmedSearch)}
                >
                  <span className="truncate">Use exactly “{trimmedSearch}”</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {displayValues.map((value: string) => (
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
  const takesValue = opTakesValues(filter.op) || opTakesOneValue(filter.op);
  const summary = takesValue ? valueSummary(filter.values) : null;

  return (
    <div className="bg-background ring-offset-background focus-within:border-ring focus-within:ring-primary flex w-full items-stretch overflow-hidden rounded-md border text-xs focus-within:ring-2 focus-within:ring-offset-[3px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- PopoverTrigger supplies the existing visible children through render; keep its accessible name unchanged.
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
          {takesValue ? (
            <span className="truncate">
              {summary ?? (
                <span className="text-muted-foreground/70 italic">
                  {opTakesOneValue(filter.op) ? "no value yet" : "any value"}
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
