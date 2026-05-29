import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { ListFilter } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ServiceIdentity } from "../data/types";

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
    value.minMs !== undefined ||
    value.maxMs !== undefined ||
    value.status !== "all";

  return (
    <aside
      aria-label="Trace filters"
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListFilter className="text-muted-foreground size-3.5" />
        Filter
      </div>
      <FilterCombobox
        label="Namespace"
        values={value.namespace}
        onChange={(next) => onChange({ namespace: next })}
        options={namespaceOptions}
        placeholder="All"
        searchPlaceholder="Search namespaces..."
        className="w-full"
      />
      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(next) => onChange({ service: next })}
        options={serviceOptions}
        placeholder="All"
        searchPlaceholder="Search services..."
        className="w-full"
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
          size="lg"
          spacing={0}
          className="w-full"
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
          <ToggleGroupItem value="all" className="flex-1">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="ok" className="flex-1">
            Ok
          </ToggleGroupItem>
          <ToggleGroupItem value="error" className="flex-1">
            Error
          </ToggleGroupItem>
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
              minMs: undefined,
              maxMs: undefined,
              status: "all",
            })
          }
        >
          Clear filters
        </button>
      )}
    </aside>
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
  const asString = (v: number | undefined) =>
    v === undefined ? "" : String(v);
  const [local, setLocal] = useState(asString(value));
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    lastValueRef.current = value;
    setLocal(asString(value));
  }

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0) {
      onCommit(parsed);
    } else {
      setLocal(asString(value));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="\d*"
        placeholder="—"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setLocal(asString(value));
          }
        }}
        onBlur={commit}
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
