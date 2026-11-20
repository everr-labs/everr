import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { Eye, EyeOff, X } from "lucide-react";
import { useRef } from "react";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { GroupByKey, MetricAggregation, MetricKind } from "../data/schemas";
import type { MetricMetadata } from "../data/types";
import { METRIC_KIND_LABELS, temporalityLabel, unitName } from "./format";
import { MetricName, queryLetterClass, queryTagClass } from "./metric-name";
import { MetricPicker, type MetricPickerProps } from "./metric-picker";
import { QueryControls } from "./metric-view";

const ROW = "flex min-h-11 flex-wrap items-center gap-2 border-b px-4 py-2 last:border-b-0";

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onRemove}>
      <X />
    </Button>
  );
}

/**
 * One query of a chart with several: its letter, metric, aggregation and
 * group-by. Its letter, or opening its metric, points the rail's attribute
 * filters at it.
 */
export function QueryRow({
  id,
  metric,
  kind,
  entry,
  picker,
  selected,
  filterCount,
  aggregations,
  aggregation,
  groupBy,
  attributeRepo,
  attributeDomain,
  timeRange,
  onSelect,
  hidden,
  onToggleHidden,
  onRemove,
  onAggregationChange,
  onGroupByChange,
}: {
  id: string;
  metric: string;
  kind: MetricKind | null;
  entry: MetricMetadata | undefined;
  picker: MetricPickerProps;
  selected: boolean;
  filterCount: number;
  aggregations: MetricAggregation[];
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  attributeRepo: AttributeRepositoryLike;
  attributeDomain: string;
  timeRange: { from: string; to: string };
  onSelect: () => void;
  hidden: boolean;
  onToggleHidden: () => void;
  onRemove: () => void;
  onAggregationChange: (aggregation: MetricAggregation) => void;
  onGroupByChange: (groupBy: GroupByKey[]) => void;
}) {
  const tagRef = useRef<HTMLDivElement>(null);
  return (
    <div
      className={cn(
        ROW,
        selected && "bg-muted/40",
        // The buttons at the end stay readable; the rest dims.
        hidden && "[&>*:not(:last-child)]:opacity-50",
      )}
    >
      <div ref={tagRef} className={queryTagClass(selected)}>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Filter query ${id} in the sidebar`}
          title="Filter this query in the sidebar"
          className={cn(queryLetterClass(selected), "hover:bg-muted cursor-pointer")}
        >
          {id}
          {filterCount > 0 ? (
            <span className="text-muted-foreground font-sans">
              {filterCount === 1 ? "1 filter" : `${filterCount} filters`}
            </span>
          ) : null}
        </button>
        <MetricPicker
          {...picker}
          label={`Query ${id}: ${metric}. Change metric`}
          onOpen={onSelect}
          // The list opens under the whole tag, letter included.
          anchor={tagRef}
          className="rounded-none px-2"
          details={
            <>
              <span className="font-mono break-all">{metric}</span>
              {entry?.description ? <span>{entry.description}</span> : null}
              {entry ? (
                <span className="opacity-70">
                  {[
                    kind ? METRIC_KIND_LABELS[kind] : null,
                    entry.unit ? unitName(entry.unit) : null,
                    temporalityLabel(entry.temporality),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </>
          }
        >
          <span className="max-w-72 truncate font-mono text-xs">
            <MetricName name={metric} />
          </span>
          {entry?.unit ? (
            <span className="text-muted-foreground shrink-0 text-xs">{unitName(entry.unit)}</span>
          ) : null}
        </MetricPicker>
      </div>
      <QueryControls
        aggregations={aggregations}
        aggregation={aggregation}
        groupBy={groupBy}
        attributeRepo={attributeRepo}
        attributeDomain={attributeDomain}
        timeRange={timeRange}
        onAggregationChange={onAggregationChange}
        onGroupByChange={onGroupByChange}
      />
      <div className="ml-auto flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          // One name, pressed while hidden, so it never reads as both.
          aria-label={`Hide query ${id} from the chart`}
          aria-pressed={hidden}
          title={hidden ? "Show on the chart" : "Hide from the chart"}
          onClick={onToggleHidden}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </Button>
        <RemoveButton label={`Remove query ${id}`} onRemove={onRemove} />
      </div>
    </div>
  );
}
