import { cn } from "@everr/ui/lib/utils";
import type { Span } from "@/data/traces/types";
import { serviceColor } from "../shared/service-color";

type Props = {
  span: Span;
  traceStartNs: bigint;
  traceEndNs: bigint;
};

export function SpanBar({ span, traceStartNs, traceEndNs }: Props) {
  const totalNs = traceEndNs - traceStartNs;
  const spanStart = BigInt(span.timestampNs);
  const spanDur = BigInt(span.duration);
  const offsetNs = spanStart - traceStartNs;

  const leftPct =
    totalNs === 0n ? 0 : Number((offsetNs * 10_000n) / totalNs) / 100;
  const widthPct =
    totalNs === 0n ? 0 : Number((spanDur * 10_000n) / totalNs) / 100;

  const isError = span.statusCode === "Error";
  const isZero = spanDur === 0n;

  return (
    <div
      className={cn(
        "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm",
        isError && "ring-1 ring-destructive",
      )}
      style={{
        left: `${leftPct}%`,
        width: isZero ? undefined : `${Math.max(widthPct, 0.1)}%`,
        minWidth: isZero ? "1px" : undefined,
        backgroundColor: serviceColor(span.serviceNamespace, span.serviceName),
      }}
    >
      {isError && (
        <div className="bg-destructive/30 absolute inset-0 rounded-sm" />
      )}
    </div>
  );
}
