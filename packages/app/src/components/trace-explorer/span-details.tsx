import { Button } from "@everr/ui/components/button";
import {
  AttributeMap,
  DetailItem,
  DetailSection,
} from "@everr/ui/components/detail-panel";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import { formatDuration } from "@everr/ui/lib/formatting";
import { Link } from "@tanstack/react-router";
import { Copy, Focus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { TraceNode } from "./trace-model";

export function SpanDetails({
  node,
  durationMs,
  start,
  end,
  onClose,
  onFocus,
}: {
  node: TraceNode;
  durationMs: number;
  start: string;
  end: string;
  onClose: () => void;
  onFocus: () => void;
}) {
  const [tab, setTab] = useState<string | null>("overview");
  const span = node.source;
  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label="Span details">
      <div className="flex shrink-0 items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground truncate text-xs">
            {span.serviceName}
          </div>
          <h2 className="mt-1 break-words text-sm font-medium">
            {span.spanName}
          </h2>
          <div className="mt-1 font-mono text-xs">
            {formatDuration(Number(span.duration), "ns")}{" "}
            <span className="text-muted-foreground">
              ({((node.durationNano / 1e6 / durationMs) * 100).toFixed(1)}% of
              trace)
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close span details"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="flex shrink-0 gap-1 border-b p-2">
        <Button variant="outline" size="sm" onClick={onFocus}>
          <Focus />
          Zoom to span
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy span link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Span link copied");
            } catch {
              toast.error("Could not copy span link");
            }
          }}
        >
          <Copy />
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="mx-3 shrink-0 border-b">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">
            Events ({span.events.length})
          </TabsTrigger>
          <TabsTrigger value="links">Links ({span.links.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full" viewportClassName="p-3">
            <DetailSection title="Span">
              <DetailItem label="Status" value={span.statusCode} />
              <DetailItem label="Kind" value={span.spanKind} />
              <DetailItem label="Start" value={span.timestamp} mono />
              <DetailItem
                label="Relative start"
                value={`+${formatDuration(node.timestamp, "ms")}`}
                mono
              />
              <DetailItem label="Span ID" value={span.spanId} mono />
              <DetailItem
                label="Parent ID"
                value={span.parentSpanId || undefined}
                mono
              />
            </DetailSection>
            <AttributeMap title="Span attributes" map={span.spanAttributes} />
            <AttributeMap
              title="Resource attributes"
              map={span.resourceAttributes}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="events" className="min-h-0 overflow-auto p-3">
          {span.events.length === 0 ? (
            <p className="text-muted-foreground text-xs">No span events.</p>
          ) : (
            span.events.map((event, i) => (
              <div
                key={`${event.timestamp}-${i}`}
                className="mb-3 rounded-md border p-3 text-xs"
              >
                <div className="mb-1 font-medium">{event.name}</div>
                <div className="text-muted-foreground mb-2 break-all font-mono text-[10px]">
                  {event.timestamp}
                </div>
                <AttributeMap title="Attributes" map={event.attributes} />
              </div>
            ))
          )}
        </TabsContent>
        <TabsContent value="links" className="min-h-0 overflow-auto p-3">
          {span.links.length === 0 ? (
            <p className="text-muted-foreground text-xs">No span links.</p>
          ) : (
            span.links.map((link, i) => (
              <div
                key={`${link.traceId}-${link.spanId}-${i}`}
                className="mb-3 rounded-md border p-3 text-xs"
              >
                <Link
                  to="/traces/$traceId"
                  params={{ traceId: link.traceId }}
                  search={
                    link.traceId === span.traceId
                      ? { start, end, span: link.spanId }
                      : { span: link.spanId }
                  }
                  className="break-all font-mono text-primary underline"
                >
                  {link.traceId} / {link.spanId}
                </Link>
                <AttributeMap title="Attributes" map={link.attributes} />
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
