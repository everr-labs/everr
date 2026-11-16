import { cn } from "@everr/ui/lib/utils";
import { isSafeMethod, splitSpanName } from "./http-method";

/**
 * A span name with its HTTP method set apart, the same way in the trace list
 * and in the trace viewer.
 */
export function SpanName({
  name,
  methodClassName,
  labelClassName,
}: {
  name: string;
  methodClassName?: string;
  labelClassName?: string;
}) {
  const { method, label } = splitSpanName(name);
  return (
    <>
      {method && <HttpMethodBadge method={method} className={methodClassName} />}
      {/* A space character, and not only a flex gap or a margin. Without it the
          accessible name becomes "POST/api/users". A run of space characters
          is not a flex item, so the layout does not change. */}
      {method && label ? " " : null}
      {label && <span className={labelClassName}>{label}</span>}
    </>
  );
}

// Two tones for nine methods. The methods that read share one tone, and the
// methods that change state share the other. Tinted text only, no chip: a
// chip on every row competes with the one that matters, a failed trace. The
// method is always spelled out, so colour is never the only signal.
function HttpMethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono font-medium text-[0.625rem] tracking-wide",
        isSafeMethod(method) ? "text-sky-400/90" : "text-amber-400/90",
        className,
      )}
    >
      {method}
    </span>
  );
}
