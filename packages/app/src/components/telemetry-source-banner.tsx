import { useTelemetrySource } from "@/lib/telemetry-source/context";

/**
 * One message when Local is selected but the collector has stopped answering,
 * instead of the same connection error repeated on every panel. Panels keep
 * showing cloud data meanwhile, because the provider falls back rather than
 * stranding the page on a backend that cannot answer.
 */
export function TelemetrySourceBanner() {
  const { localUnreachable } = useTelemetrySource();
  if (!localUnreachable) return null;

  return (
    <div
      role="status"
      className="mx-3 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      The local collector is not answering, so panels are showing cloud data.
      Start it to read local telemetry.
    </div>
  );
}
