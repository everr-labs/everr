import { Button } from "@everr/ui/components/button";
import { X } from "lucide-react";
import type { Span } from "@/data/traces/types";
import { formatDuration } from "@/lib/formatting";

type Props = {
  span: Span;
  traceStartNs: bigint;
  onClose: () => void;
};

export function SpanDetailPanel({ span, traceStartNs, onClose }: Props) {
  const spanStart = BigInt(span.timestampNs);
  const relativeNs = spanStart - traceStartNs;

  return (
    <aside className="bg-background flex w-96 shrink-0 flex-col overflow-hidden border-l">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{span.spanName}</div>
          <div className="text-muted-foreground truncate text-[10px]">
            {span.serviceName}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-3 text-xs">
        <Section title="Overview">
          <Row label="Status" value={span.statusCode} />
          <Row label="Kind" value={span.spanKind || "—"} />
          <Row label="Service" value={span.serviceName} />
          {span.serviceNamespace && (
            <Row label="Namespace" value={span.serviceNamespace} />
          )}
        </Section>

        <Section title="Timing">
          <Row label="Start" value={span.timestamp} />
          <Row
            label="Relative"
            value={`+${formatDuration(Number(relativeNs), "ns")}`}
          />
          <Row
            label="Duration"
            value={formatDuration(Number(span.duration), "ns")}
          />
        </Section>

        <AttributeSection
          title="Span attributes"
          attributes={span.spanAttributes}
        />
        <AttributeSection
          title="Resource attributes"
          attributes={span.resourceAttributes}
        />

        {span.events.length > 0 && (
          <Section title={`Events (${span.events.length})`}>
            <div className="space-y-2">
              {span.events.map((event, idx) => (
                <div
                  key={`${event.timestamp}-${idx}`}
                  className="bg-muted/40 rounded-md p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{event.name}</span>
                    <span className="text-muted-foreground text-[10px] tabular-nums">
                      {event.timestamp}
                    </span>
                  </div>
                  <AttributeList attributes={event.attributes} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {span.links.length > 0 && (
          <Section title={`Links (${span.links.length})`}>
            <div className="space-y-2">
              {span.links.map((link, idx) => (
                <div
                  key={`${link.traceId}-${link.spanId}-${idx}`}
                  className="bg-muted/40 rounded-md p-2"
                >
                  <Row label="Trace" value={link.traceId} mono />
                  <Row label="Span" value={link.spanId} mono />
                  <AttributeList attributes={link.attributes} />
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase tracking-wide">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-2">
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <span
        className={mono ? "truncate font-mono text-[11px]" : "truncate text-xs"}
      >
        {value}
      </span>
    </div>
  );
}

function AttributeSection({
  title,
  attributes,
}: {
  title: string;
  attributes: Record<string, string>;
}) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return (
    <Section title={`${title} (${entries.length})`}>
      <AttributeList attributes={attributes} />
    </Section>
  );
}

function AttributeList({ attributes }: { attributes: Record<string, string> }) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(80px,_1fr)_minmax(0,_2fr)] gap-2"
        >
          <span className="text-muted-foreground truncate font-mono text-[10px]">
            {key}
          </span>
          <span className="break-all font-mono text-[10px]">{value}</span>
        </div>
      ))}
    </div>
  );
}
