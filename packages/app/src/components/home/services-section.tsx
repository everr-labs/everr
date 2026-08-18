import { serviceColor } from "@everr/telemetry-explorer/traces";
import { Card } from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { compactNumber, SectionLabel } from "@/components/home/stat-tile";
import type { HomeService } from "@/data/home/server";

/** Undefined services render the loading skeleton; an empty list renders nothing. */
export function ServicesSection({
  services,
}: {
  services: HomeService[] | undefined;
}) {
  if (services && services.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionLabel>Services</SectionLabel>
      <Card className="divide-border gap-0 divide-y py-0">
        {services === undefined
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))
          : services.map((service) => (
              <Link
                key={service.name}
                to="/traces"
                search={{ service: [service.name] }}
                className="hover:bg-muted/30 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: serviceColor(service.name) }}
                />
                <span className="truncate text-sm font-medium">
                  {service.name}
                </span>
                <span className="flex-1" />
                <ServiceStat value={service.logCount} label="logs" />
                <ServiceStat value={service.traceCount} label="traces" />
                <ServiceStat value={service.errorCount} label="errors" />
              </Link>
            ))}
      </Card>
    </section>
  );
}

function ServiceStat({ value, label }: { value: number; label: string }) {
  return (
    <span className="w-20 text-right">
      <span className="block text-sm tabular-nums">
        {compactNumber.format(value)}
      </span>
      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
        {label}
      </span>
    </span>
  );
}
