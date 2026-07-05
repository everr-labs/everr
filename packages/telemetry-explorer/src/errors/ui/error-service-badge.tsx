import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";

const serviceDotClassNames = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

function serviceDotClassName(serviceName: string): string {
  let hash = 0;

  for (const char of serviceName) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return serviceDotClassNames[hash % serviceDotClassNames.length] ?? "bg-chart-1";
}

export function ErrorServiceBadge({ serviceName }: { serviceName: string }) {
  const label = serviceName || "unknown-service";

  return (
    <Badge variant="outline" className="max-w-52 justify-start" title={label}>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", serviceDotClassName(label))}
      />
      <span className="truncate">{label}</span>
    </Badge>
  );
}
