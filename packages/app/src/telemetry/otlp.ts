export type OtlpSignal = "logs" | "metrics" | "traces";

export function normalizeOtlpOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function buildOtlpSignalUrl(origin: string, signal: OtlpSignal): string {
  return `${normalizeOtlpOrigin(origin)}/v1/${signal}`;
}
