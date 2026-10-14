/** Cloud builds send keyed telemetry to Everr's hosted OTLP receiver by default. */
export function getDefaultTelemetryEndpoint(): string {
  return "https://ingest.everr.dev";
}
