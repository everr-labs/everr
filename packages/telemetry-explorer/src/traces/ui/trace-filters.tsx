import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { type ReactNode, useId, useRef, useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { ExploreFilterRail } from "../../filters/ui/explore-filter-rail";
import type { TracesRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import type { ServiceIdentity } from "../data/types";
import {
  TRACES_ATTRIBUTE_SOURCES_UI,
  TRACES_EXCLUDED_KEYS,
  TRACES_PROMOTED_ATTRIBUTES,
} from "./trace-attribute-config";

type StatusValue = "ok" | "error" | "all";

type FilterValue = {
  namespace: string[];
  name: string;
  minMs?: number;
  maxMs?: number;
  status: StatusValue;
  attributes: AttributeFilter[];
};

type TraceFiltersProps = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  value: FilterValue;
  identities: ServiceIdentity[];
  // The top zone of the rail: Service and Environment. The host app supplies it,
  // because the two values are search params that are shared between pages.
  persistentFilters?: ReactNode;
  persistentFilterCount?: number;
  onChange: (patch: Partial<FilterValue>) => void;
};

export function TraceFilters({
  repo,
  timeRange,
  value,
  identities,
  persistentFilters,
  persistentFilterCount = 0,
  onChange,
}: TraceFiltersProps) {
  const namespaces = dedupe(
    identities.map((i) => i.serviceNamespace).filter((n) => n.length > 0),
  );

  const namespaceOptions = staticListOptions(
    ["traces", "filter", "namespaces", namespaces] as const,
    namespaces,
  );

  // The count for the bottom zone of the rail, which includes the search text.
  const pageFilterCount =
    (value.namespace.length > 0 ? 1 : 0) +
    (value.name.length > 0 ? 1 : 0) +
    (value.minMs !== undefined || value.maxMs !== undefined ? 1 : 0) +
    (value.status !== "all" ? 1 : 0) +
    value.attributes.length;

  return (
    <ExploreFilterRail
      label="Trace filters"
      persistentFilters={persistentFilters}
      persistentFilterCount={persistentFilterCount}
      pageFilterCount={pageFilterCount}
      onClear={() =>
        onChange({
          namespace: [],
          name: "",
          minMs: undefined,
          maxMs: undefined,
          status: "all",
          attributes: [],
        })
      }
    >
      <FilterSearchBar
        id="traces-search"
        label="Search"
        value={value.name}
        onChange={(name) => onChange({ name })}
        placeholder="Filter by span name"
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

      <FilterCombobox
        label="Namespace"
        values={value.namespace}
        onChange={(next) => onChange({ namespace: next })}
        options={namespaceOptions}
        placeholder="All"
        searchPlaceholder="Search namespaces..."
        className="w-full"
      />

      <div className="flex gap-2">
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
      </div>

      <AttributeFilterSection
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        attributes={value.attributes}
        promotedAttributes={TRACES_PROMOTED_ATTRIBUTES}
        excludedKeys={TRACES_EXCLUDED_KEYS}
        sources={TRACES_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) => onChange({ attributes })}
      />
    </ExploreFilterRail>
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
    <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        className="w-full"
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
