import { StorageNotReadyError } from "@everr/app/common/storage-readiness";

const CLICKHOUSE_SETUP_MESSAGE =
  "We're setting up your organization's data access. This is taking a little longer than usual. We'll keep trying automatically. Please try again shortly.";

export const ORGANIZATION_SETUP_DELAY_NOTICE_MS = 30_000;

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
    throw new StorageNotReadyError(CLICKHOUSE_SETUP_MESSAGE);
}
