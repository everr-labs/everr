import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useId, useRef, useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { AttributeValueCombobox } from "../../filters/ui/attribute-value-combobox";
import {
  ENVIRONMENT_ATTRIBUTE,
  splitDedicatedAttributes,
} from "../../filters/ui/dedicated-attributes";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
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
  service: string[];
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
  onChange: (patch: Partial<FilterValue>) => void;
};

export function TraceFilters({
  repo,
  timeRange,
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

  const { dedicated: dedicatedAttributes, rest: pickerAttributes } =
    splitDedicatedAttributes(value.attributes, [ENVIRONMENT_ATTRIBUTE]);

  // "Clear all" resets the sidebar filters only. The span-name search lives in
  // the header search bar (with its own clear control), so it is not part of
  // hasActiveFilters nor reset by onClear.
  const hasActiveFilters =
    value.namespace.length > 0 ||
    value.service.length > 0 ||
    value.minMs !== undefined ||
    value.maxMs !== undefined ||
    value.status !== "all" ||
    value.attributes.length > 0;

  return (
    <FilterSidebar
      label="Trace filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          namespace: [],
          service: [],
          minMs: undefined,
          maxMs: undefined,
          status: "all",
          attributes: [],
        })
      }
    >
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

      <Separator />

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

      <AttributeValueCombobox
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        source={ENVIRONMENT_ATTRIBUTE.source}
        attributeKey={ENVIRONMENT_ATTRIBUTE.key}
        label="Environment"
        placeholder="All environments"
        searchPlaceholder="Search environments..."
        attributes={value.attributes}
        onChange={(attributes) => onChange({ attributes })}
      />

      <Separator />

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

      <Separator />

      <AttributeFilterSection
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        attributes={pickerAttributes}
        promotedAttributes={TRACES_PROMOTED_ATTRIBUTES}
        excludedKeys={TRACES_EXCLUDED_KEYS}
        sources={TRACES_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) =>
          onChange({ attributes: [...dedicatedAttributes, ...attributes] })
        }
      />
    </FilterSidebar>
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
