import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import { Label } from "@everr/ui/components/label";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { Gauge, Hash } from "lucide-react";
import type { ReactNode } from "react";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { ExploreFilterRail } from "../../filters/ui/explore-filter-rail";
import { ExploreFilterSelect } from "../../filters/ui/explore-filter-select";
import type { ProfilesRepositoryLike } from "../data/repository";
import { PROFILES_ATTRIBUTE_SOURCES } from "../data/schemas";
import type { SampleTypeOption } from "../data/types";

export type ProfileFilterValue = {
  q: string;
  sampleType: string | undefined;
  sampleUnit: string | undefined;
  traceId: string | undefined;
  spanId: string | undefined;
  attributes: AttributeFilter[];
};

export type ProfileFilterPatch = Partial<ProfileFilterValue>;

export const CLEARED_PROFILE_FILTERS: ProfileFilterPatch = {
  q: "",
  traceId: undefined,
  spanId: undefined,
  attributes: [],
};

// The endpoint attributes come first: narrowing to one route or root span is
// the usual way into a profile.
const PROFILES_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "sample", key: "http.route" },
  { source: "sample", key: "everr.root_span.name" },
  { source: "resource", key: "host.name" },
  { source: "resource", key: "process.executable.name" },
  { source: "sample", key: "thread.name" },
];

// Service and Environment have controls in the top zone of the rail.
const PROFILES_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment",
]);

export function sampleTypeLabel(option: SampleTypeOption): string {
  return option.sampleUnit ? `${option.sampleType} (${option.sampleUnit})` : option.sampleType;
}

function sampleTypeKey(option: SampleTypeOption): string {
  return `${option.sampleType}\u0000${option.sampleUnit}`;
}

/** The page zone counts every filter but the sample type, which always has a value. */
export function countProfileFilters(value: {
  q: string;
  traceId?: string;
  spanId?: string;
  attributes: readonly AttributeFilter[];
}): number {
  return (
    (value.q ? 1 : 0) + (value.traceId ? 1 : 0) + (value.spanId ? 1 : 0) + value.attributes.length
  );
}

export function ProfileFilters({
  repo,
  timeRange,
  value,
  sampleTypes,
  sampleType,
  persistentFilters,
  persistentFilterCount,
  onChange,
}: {
  repo: ProfilesRepositoryLike;
  timeRange: TimeRange;
  value: ProfileFilterValue;
  sampleTypes: readonly SampleTypeOption[];
  sampleType: SampleTypeOption | undefined;
  persistentFilters?: ReactNode;
  persistentFilterCount: number;
  onChange: (patch: ProfileFilterPatch) => void;
}) {
  return (
    <ExploreFilterRail
      label="Profile filters"
      persistentFilters={persistentFilters}
      persistentFilterCount={persistentFilterCount}
      pageFilterCount={countProfileFilters(value)}
      onClear={() => onChange(CLEARED_PROFILE_FILTERS)}
    >
      <FilterSearchBar
        id="profiles-search"
        label="Search"
        value={value.q}
        onChange={(q) => onChange({ q })}
        placeholder="Filter by function name"
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor="profiles-sample-type" className="text-muted-foreground text-xs">
          Sample type
        </Label>
        <ExploreFilterSelect
          id="profiles-sample-type"
          label="Sample type"
          icon={Gauge}
          value={sampleType ? sampleTypeKey(sampleType) : undefined}
          options={sampleTypes.map((option) => ({
            value: sampleTypeKey(option),
            label: sampleTypeLabel(option),
          }))}
          onChange={(next) => {
            const option = sampleTypes.find((o) => sampleTypeKey(o) === next);
            if (option) {
              onChange({ sampleType: option.sampleType, sampleUnit: option.sampleUnit });
            }
          }}
          placeholder="No samples"
          searchPlaceholder="Search sample types..."
        />
      </div>

      <FilterSearchBar
        id="profiles-trace-id"
        label="Trace"
        icon={Hash}
        value={value.traceId ?? ""}
        onChange={(next) => onChange({ traceId: next || undefined })}
        placeholder="Any trace"
      />

      <FilterSearchBar
        id="profiles-span-id"
        label="Span"
        icon={Hash}
        value={value.spanId ?? ""}
        onChange={(next) => onChange({ spanId: next || undefined })}
        placeholder="Any span"
      />

      <AttributeFilterSection
        repo={repo}
        domain="profiles"
        timeRange={timeRange}
        attributes={value.attributes}
        promotedAttributes={PROFILES_PROMOTED_ATTRIBUTES}
        excludedKeys={PROFILES_EXCLUDED_KEYS}
        sources={[...PROFILES_ATTRIBUTE_SOURCES]}
        onChange={(attributes) => onChange({ attributes })}
      />
    </ExploreFilterRail>
  );
}
