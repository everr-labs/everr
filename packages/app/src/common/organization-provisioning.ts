import { ClickhouseProvisioningPendingError } from "./clickhouse-provisioning";

export function parseOrganizationMetadata(
  value: unknown,
): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isOrganizationProvisioned(metadata: unknown): boolean {
  // Organizations created before provisioning state was tracked stay ready.
  return parseOrganizationMetadata(metadata).clickhouseReady !== false;
}

export function assertOrganizationProvisioned(metadata: unknown): void {
  if (!isOrganizationProvisioned(metadata))
    throw new ClickhouseProvisioningPendingError();
}
