import { CopyValueButton } from "@everr/ui/components/detail-panel";
import { cn } from "@everr/ui/lib/utils";
import { Clock3, Fingerprint } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "@/data/errors/types";
import { ErrorServiceBadge } from "./error-service-badge";

function DetailRows({ children }: { children: ReactNode }) {
  return <dl className="divide-y text-xs">{children}</dl>;
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon?: ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="group relative grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 py-2">
      <dt className="flex min-w-0 items-center gap-1 text-muted-foreground">
        {icon ? <span className="[&>svg]:size-3">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cn(
          "min-w-0 truncate pr-6 text-right",
          mono && "font-mono",
          !value && "text-muted-foreground",
        )}
      >
        {value || "N/A"}
      </dd>
      {value ? (
        <CopyValueButton
          value={value}
          className="absolute right-0 top-1/2 -translate-y-1/2 bg-background"
        />
      ) : null}
    </div>
  );
}

function AttributeRows({
  title,
  map,
}: {
  title: string;
  map: Record<string, string>;
}) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;

  return (
    <section>
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h4>
      <DetailRows>
        {entries.map(([key, value]) => (
          <DetailRow key={key} label={key} value={value} mono />
        ))}
      </DetailRows>
    </section>
  );
}

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

      <div className="grid xl:grid-cols-2">
        <section className="p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Occurrence
            </h3>
            <ErrorServiceBadge serviceName={occurrence.serviceName} />
          </div>
          <DetailRows>
            <DetailRow
              icon={<Clock3 />}
              label="Timestamp"
              value={occurrence.timestamp}
              mono
            />
            <DetailRow
              icon={<Fingerprint />}
              label="Fingerprint"
              value={occurrence.fingerprint}
              mono
            />
            <DetailRow label="Trace" value={occurrence.traceId} mono />
            <DetailRow label="Span" value={occurrence.spanId} mono />
          </DetailRows>
        </section>

        <section className="group min-w-0 border-t p-3 xl:border-l xl:border-t-0">
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
          <DetailRows>
            <DetailRow label="Type" value={occurrence.exceptionType} />
            <DetailRow label="Message" value={occurrence.exceptionMessage} />
          </DetailRows>
        </section>
      </div>

      {hasAttributes ? (
        <div className="border-t p-3">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">
            Attributes
          </h3>
          <div className="grid gap-4">
            <AttributeRows
              title="Resource attributes"
              map={occurrence.resourceAttributes}
            />
            <AttributeRows
              title="Log attributes"
              map={occurrence.logAttributes}
            />
            <AttributeRows
              title="Scope attributes"
              map={occurrence.scopeAttributes}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
