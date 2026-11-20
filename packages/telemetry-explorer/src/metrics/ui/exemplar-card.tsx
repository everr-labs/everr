import { Popover, PopoverContent } from "@everr/ui/components/popover";
import { formatRowTimestamp } from "@everr/ui/lib/timestamp";
import { ScrollText, Waypoints } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { attributeLabel } from "../../attribute-filter/ui/attribute-meta";
import { CopyId } from "../../errors/ui/copy-id";
import type { MetricExemplar } from "../data/types";

export type ExemplarLinkRenderProps = {
  traceId: string;
  spanId: string;
  className: string;
  children: ReactNode;
};

const LINK_CLASS =
  "hover:bg-muted focus-visible:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-xs focus-visible:outline-none [&_svg]:text-muted-foreground [&_svg]:size-3.5";

/**
 * What a clicked exemplar was: when it was measured, its value next to the
 * charted value of its interval, which series it belongs to, its trace, and
 * the two places to go from it. Anchored at the click, since the diamond is
 * drawn on a canvas and has no element of its own.
 */
export function ExemplarCard({
  exemplar,
  at,
  value,
  charted,
  groups,
  renderTraceLink,
  renderLogsLink,
  onClose,
}: {
  exemplar: MetricExemplar;
  at: { x: number; y: number };
  /** The exemplar's value, formatted. */
  value: string;
  /** The line it sits next to, e.g. { label: "p95", value: "984 ms" }. */
  charted: { label: string; value: string } | null;
  /** The group-by keys and this exemplar's values for them. */
  groups: { key: string; value: string }[];
  renderTraceLink: (props: ExemplarLinkRenderProps) => ReactNode;
  renderLogsLink: (props: ExemplarLinkRenderProps) => ReactNode;
  onClose: () => void;
}) {
  const anchor = {
    getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }),
  };
  const link = { traceId: exemplar.traceId, spanId: exemplar.spanId, className: LINK_CLASS };
  // Focus starts on "Open trace", the likely next step. The default, the
  // first control, is the trace ID's copy button, whose tooltip would then
  // open over the card.
  const actionsRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="start"
        className="w-64 gap-0 p-0"
        initialFocus={() => actionsRef.current?.querySelector("a") ?? null}
      >
        <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
          <span className="font-medium">Exemplar</span>
          <span className="text-muted-foreground tabular-nums">
            {formatRowTimestamp(exemplar.time, true)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-2 px-3 pt-2 pb-2.5">
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="text-base font-medium tabular-nums">{value}</dd>
          </div>
          {charted ? (
            <div className="flex flex-col">
              <dt className="text-muted-foreground">{charted.label} this interval</dt>
              <dd className="text-muted-foreground text-base tabular-nums">{charted.value}</dd>
            </div>
          ) : null}
        </dl>

        <dl className="flex flex-col gap-1 border-t px-3 py-2">
          {groups.map(({ key, value }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground shrink-0">{attributeLabel(key) ?? key}</dt>
              <dd className="min-w-0 truncate font-mono" title={value}>
                {value === "" ? "(none)" : value}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Trace</dt>
            <dd>
              <CopyId value={exemplar.traceId} label="trace ID" />
            </dd>
          </div>
        </dl>

        <div ref={actionsRef} className="flex flex-col border-t p-1">
          {renderTraceLink({
            ...link,
            children: (
              <>
                <Waypoints />
                Open trace
              </>
            ),
          })}
          {renderLogsLink({
            ...link,
            children: (
              <>
                <ScrollText />
                Logs for this trace
              </>
            ),
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
