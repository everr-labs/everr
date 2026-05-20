import { Button } from "@everr/ui/components/button";
import {
  AttributeMap,
  DetailItem,
  DetailSection,
} from "@everr/ui/components/detail-panel";
import { Clock3, Fingerprint, Server, X } from "lucide-react";
import type { Span } from "@/data/traces/types";
import { formatDuration } from "@/lib/formatting";

type Props = {
  span: Span;
  traceStartNs: bigint;
  onClose: () => void;
};

export function SpanDetailPanel({ span, traceStartNs, onClose }: Props) {
  const relativeNs = BigInt(span.timestampNs) - traceStartNs;

  return (
    <aside className="bg-background flex w-96 shrink-0 flex-col overflow-hidden border-l">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{span.spanName}</div>
          <div className="text-muted-foreground truncate text-xs">
            {span.serviceName}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <DetailSection title="Overview">
          <DetailItem
            icon={<Server />}
            label="Service"
            value={span.serviceName}
          />
          {span.serviceNamespace ? (
            <DetailItem label="Namespace" value={span.serviceNamespace} />
          ) : null}
          <DetailItem label="Status" value={span.statusCode} />
          <DetailItem label="Kind" value={span.spanKind || undefined} />
        </DetailSection>

        <DetailSection title="Timing">
          <DetailItem
            icon={<Clock3 />}
            label="Start"
            value={span.timestamp}
            mono
          />
          <DetailItem
            label="Relative"
            value={`+${formatDuration(Number(relativeNs), "ns")}`}
          />
          <DetailItem
            label="Duration"
            value={formatDuration(Number(span.duration), "ns")}
          />
        </DetailSection>

        <DetailSection title="Identifiers">
          <DetailItem
            icon={<Fingerprint />}
            label="Span ID"
            value={span.spanId}
            mono
          />
          {span.parentSpanId ? (
            <DetailItem label="Parent" value={span.parentSpanId} mono />
          ) : null}
        </DetailSection>

        <AttributeMap title="Span attributes" map={span.spanAttributes} />
        <AttributeMap
          title="Resource attributes"
          map={span.resourceAttributes}
        />

        {span.events.length > 0 ? (
          <DetailSection title={`Events (${span.events.length})`}>
            {span.events.map((event, idx) => (
              <div
                key={`${event.timestamp}-${idx}`}
                className="bg-muted/40 grid gap-2 rounded-md p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{event.name}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                    {event.timestamp}
                  </span>
                </div>
                {Object.entries(event.attributes).map(([k, v]) => (
                  <DetailItem key={k} label={k} value={v} mono />
                ))}
              </div>
            ))}
          </DetailSection>
        ) : null}

        {span.links.length > 0 ? (
          <DetailSection title={`Links (${span.links.length})`}>
            {span.links.map((link, idx) => (
              <div
                key={`${link.traceId}-${link.spanId}-${idx}`}
                className="bg-muted/40 grid gap-2 rounded-md p-2"
              >
                <DetailItem label="Trace" value={link.traceId} mono />
                <DetailItem label="Span" value={link.spanId} mono />
                {Object.entries(link.attributes).map(([k, v]) => (
                  <DetailItem key={k} label={k} value={v} mono />
                ))}
              </div>
            ))}
          </DetailSection>
        ) : null}
      </div>
    </aside>
  );
}
