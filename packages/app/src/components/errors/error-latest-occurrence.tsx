import {
  AttributeMap,
  DetailItem,
  DetailSection,
} from "@everr/ui/components/detail-panel";
import { Clock3, Fingerprint, Server } from "lucide-react";
import type { ErrorOccurrence } from "@/data/errors/types";

export function ErrorLatestOccurrence({
  occurrence,
}: {
  occurrence: ErrorOccurrence;
}) {
  return (
    <section className="min-w-0 rounded-md border bg-background p-3">
      <div className="mb-3">
        <h2 className="text-sm font-medium">Latest occurrence</h2>
        <p className="truncate text-xs text-muted-foreground">
          {occurrence.exceptionMessage ||
            occurrence.body ||
            occurrence.fingerprint}
        </p>
      </div>

      <DetailSection title="Overview">
        <DetailItem
          icon={<Server />}
          label="Service"
          value={occurrence.serviceName}
        />
        <DetailItem
          icon={<Clock3 />}
          label="Timestamp"
          value={occurrence.timestamp}
          mono
        />
        <DetailItem
          icon={<Fingerprint />}
          label="Fingerprint"
          value={occurrence.fingerprint}
          mono
        />
        <DetailItem label="Trace" value={occurrence.traceId} mono />
        <DetailItem label="Span" value={occurrence.spanId} mono />
      </DetailSection>

      <DetailSection title="Exception">
        <DetailItem label="Type" value={occurrence.exceptionType} />
        <DetailItem label="Message" value={occurrence.exceptionMessage} />
      </DetailSection>

      <AttributeMap
        title="Resource attributes"
        map={occurrence.resourceAttributes}
      />
      <AttributeMap title="Log attributes" map={occurrence.logAttributes} />
      <AttributeMap title="Scope attributes" map={occurrence.scopeAttributes} />
    </section>
  );
}
