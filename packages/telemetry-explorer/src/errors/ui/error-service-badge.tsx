import { Badge } from "@everr/ui/components/badge";
import { serviceColor } from "../../traces/ui/shared/service-color";

export function ErrorServiceBadge({ serviceName }: { serviceName: string }) {
  const label = serviceName || "unknown-service";

  return (
    <Badge variant="outline" className="max-w-52 justify-start" title={label}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: serviceColor(label) }}
      />
      <span className="truncate">{label}</span>
    </Badge>
  );
}
