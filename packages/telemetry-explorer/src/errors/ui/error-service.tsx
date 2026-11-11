import { cn } from "@everr/ui/lib/utils";
import { serviceColor } from "../../traces/ui/shared/service-color";

/**
 * A service as the Traces list shows it: the colour dot of the service, then
 * its name. `others` is the number of other services that also reported the
 * Error.
 */
export function ErrorService({
  serviceName,
  others = 0,
  title,
  className,
}: {
  serviceName: string;
  others?: number;
  title?: string;
  className?: string;
}) {
  const label = serviceName || "unknown-service";

  return (
    <span
      className={cn("text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs", className)}
      title={title ?? label}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: serviceColor(label) }}
      />
      <span className="min-w-0 truncate">{label}</span>
      {others > 0 ? <span className="shrink-0 tabular-nums">+{others}</span> : null}
    </span>
  );
}
