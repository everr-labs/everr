import type { TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type {
  AttributeFilter,
  AttributeSource,
} from "../../attribute-filter/schemas";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";
import { splitDedicatedAttributes } from "./dedicated-attributes";

// Wraps AttributeFilterSection for bars that promote some attributes to dedicated
// controls (e.g. Environment) whose value lives in the shared `attributes` array.
// It is the single source of the split/merge wiring: dedicated entries are hidden
// from the pills (split) and from the picker's add menu (their keys are unioned
// into excludedKeys), and merged back on change — so the "owned by a dedicated
// control" fact lives only in the `dedicated` list, not duplicated per bar/config.
export function DedicatedAttributeSection({
  repo,
  domain,
  timeRange,
  attributes,
  dedicated,
  promotedAttributes,
  excludedKeys,
  sources,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  dedicated: PromotedAttribute[];
  promotedAttributes: PromotedAttribute[];
  excludedKeys: ReadonlySet<string>;
  sources: AttributeSource[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  const { dedicated: dedicatedEntries, rest } = splitDedicatedAttributes(
    attributes,
    dedicated,
  );

  const mergedExcludedKeys = new Set(excludedKeys);
  for (const { source, key } of dedicated) {
    mergedExcludedKeys.add(`${source}:${key}`);
  }

  return (
    <AttributeFilterSection
      repo={repo}
      domain={domain}
      timeRange={timeRange}
      attributes={rest}
      promotedAttributes={promotedAttributes}
      excludedKeys={mergedExcludedKeys}
      sources={sources}
      onChange={(next) => onChange([...dedicatedEntries, ...next])}
    />
  );
}
