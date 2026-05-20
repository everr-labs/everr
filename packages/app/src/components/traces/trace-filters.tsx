import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { useEffect, useId, useState } from "react";
import { FilterCombobox } from "@/components/filter-combobox";
import type { ServiceIdentity } from "@/data/traces/types";

type StatusValue = "ok" | "error" | "all";

type FilterValue = {
  namespace: string[];
  service: string[];
  name: string;
  minMs?: number;
  maxMs?: number;
  status: StatusValue;
};

type TraceFiltersProps = {
  value: FilterValue;
  identities: ServiceIdentity[];
  onChange: (patch: Partial<FilterValue>) => void;
};

const NAME_DEBOUNCE_MS = 250;

export function TraceFilters({
  value,
  identities,
  onChange,
}: TraceFiltersProps) {
  const namespaces = dedupe(
    identities.map((i) => i.serviceNamespace).filter((n) => n.length > 0),
  );
  const serviceList = dedupe(
    identities
      .filter(
        (i) =>
          value.namespace.length === 0 ||
          value.namespace.includes(i.serviceNamespace),
      )
      .map((i) => i.serviceName),
  );

  const namespaceOptions = staticListOptions(
    ["traces", "filter", "namespaces", namespaces] as const,
    namespaces,
  );
  const serviceOptions = staticListOptions(
    ["traces", "filter", "services", serviceList] as const,
    serviceList,
  );

  const hasFilters =
    value.namespace.length > 0 ||
    value.service.length > 0 ||
    value.name.length > 0 ||
    value.minMs !== undefined ||
    value.maxMs !== undefined ||
    value.status !== "all";

  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterCombobox
        label="Namespace"
        values={value.namespace}
        onChange={(next) => onChange({ namespace: next })}
        options={namespaceOptions}
        placeholder="All"
        searchPlaceholder="Search namespaces..."
      />
      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(next) => onChange({ service: next })}
        options={serviceOptions}
        placeholder="All"
        searchPlaceholder="Search services..."
      />
      <DebouncedNameInput
        value={value.name}
        onCommit={(name) => onChange({ name })}
      />
      <DurationInput
        label="Min ms"
        value={value.minMs}
        onCommit={(minMs) => onChange({ minMs })}
      />
      <DurationInput
        label="Max ms"
        value={value.maxMs}
        onCommit={(maxMs) => onChange({ maxMs })}
      />
      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Status</Label>
        <ToggleGroup
          value={[value.status]}
          variant="outline"
          size="sm"
          spacing={0}
          onValueChange={(next) => {
            const selected = next[0];
            if (
              selected === "ok" ||
              selected === "error" ||
              selected === "all"
            ) {
              onChange({ status: selected });
            }
          }}
          aria-label="Status"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="ok">Ok</ToggleGroupItem>
          <ToggleGroupItem value="error">Error</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {hasFilters && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-end text-xs underline"
          onClick={() =>
            onChange({
              namespace: [],
              service: [],
              name: "",
              minMs: undefined,
              maxMs: undefined,
              status: "all",
            })
          }
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function DebouncedNameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) return;
    const handle = setTimeout(() => onCommit(local), NAME_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [local, value, onCommit]);

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        Name
      </Label>
      <Input
        id={id}
        type="text"
        placeholder="Span name contains..."
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="w-56"
      />
    </div>
  );
}

function DurationInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  onCommit: (next: number | undefined) => void;
}) {
  const id = useId();
  const [local, setLocal] = useState(value === undefined ? "" : String(value));

  useEffect(() => {
    setLocal(value === undefined ? "" : String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="—"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const trimmed = local.trim();
          if (trimmed === "") {
            onCommit(undefined);
            return;
          }
          const parsed = Number.parseInt(trimmed, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            onCommit(parsed);
          } else {
            setLocal(value === undefined ? "" : String(value));
          }
        }}
        className="w-24"
      />
    </div>
  );
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function staticListOptions<K extends readonly unknown[]>(
  queryKey: K,
  items: string[],
) {
  return {
    queryKey,
    queryFn: () => items,
    select: (data: string[]) => data,
  };
}
