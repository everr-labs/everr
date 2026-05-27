import {
  AttributeMap,
  CopyValueButton,
  DetailItem,
} from "@everr/ui/components/detail-panel";
import { Clock3, Fingerprint } from "lucide-react";
import type { ErrorOccurrence } from "@/data/errors/types";
import { ErrorServiceBadge } from "./error-service-badge";

export function ErrorLatestOccurrence({
  occurrence,
}: {
  occurrence: ErrorOccurrence;
}) {
  const hasAttributes =
    Object.keys(occurrence.resourceAttributes).length > 0 ||
    Object.keys(occurrence.logAttributes).length > 0 ||
    Object.keys(occurrence.scopeAttributes).length > 0;

  return (
    <section className="min-w-0 rounded-md border bg-background">
      <div className="border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Details</h2>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {occurrence.exceptionMessage ||
            occurrence.body ||
            occurrence.fingerprint}
        </p>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-2">
        <div className="rounded-md border bg-muted/10 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Occurrence
            </h3>
            <ErrorServiceBadge serviceName={occurrence.serviceName} />
          </div>
          <div className="grid gap-2">
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
          </div>
        </div>

        <div className="group min-w-0 rounded-md border bg-muted/10 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Exception
            </h3>
            {occurrence.exceptionMessage ? (
              <CopyValueButton
                value={occurrence.exceptionMessage}
                className="opacity-100 focus-visible:opacity-100"
              />
            ) : null}
          </div>
          <div className="grid gap-2">
            <DetailItem label="Type" value={occurrence.exceptionType} />
            <DetailItem label="Message" value={occurrence.exceptionMessage} />
          </div>
        </div>
      </div>

      {hasAttributes ? (
        <div className="border-t p-3">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">
            Attributes
          </h3>
          <AttributeMap
            title="Resource attributes"
            map={occurrence.resourceAttributes}
          />
          <AttributeMap title="Log attributes" map={occurrence.logAttributes} />
          <AttributeMap
            title="Scope attributes"
            map={occurrence.scopeAttributes}
          />
        </div>
      ) : null}
    </section>
  );
}
