import { createHash, randomBytes } from "node:crypto";

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// RFC 9562 version 7: 48 bits of unix milliseconds, then random bits with the
// version and variant stamped in. The history surface promises that
// `UUIDv7ToDateTime(event_id)` recovers a row's creation time, so every
// non-delivery id must come from here, never from randomUUID (v4).
export function uuidv7(at: Date = new Date()): string {
  const bytes = randomBytes(16);
  let ms = BigInt(at.getTime());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function uuidv7Time(id: string): Date {
  return new Date(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16));
}

/**
 * A UUID derived from `seed` rather than from time or randomness. Version 8
 * marks it as custom-derived, so a reader cannot mistake it for a v7 whose
 * bytes carry a timestamp. Both deterministic ids below stamp the same way,
 * so a change to the variant bits reaches both.
 */
function deterministicUuidV8(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

// A chain gets exactly one terminal suppression row, so its id derives from
// the notification event alone. Deterministic for the same reason as delivery
// ids: the lifecycle projection runs under Graphile retry, and a retry (or a
// racing second writer) must converge on one id instead of minting a phantom
// second terminal.
export function deterministicSuppressionEventId(
  notificationEventId: string,
): string {
  return deterministicUuidV8(
    `everr.alert_suppression_event.v1\0${notificationEventId}`,
  );
}

// Delivery outcome rows must not mint random ids: the reconciler re-inserts a
// lost `delivery_succeeded` row, and only a deterministic id lets that repair
// converge instead of duplicating. The id hashes the journal event, the
// delivery key and the outcome; a failed attempt additionally hashes its
// attempt time, so retries keep their own rows while the terminal success id
// stays stable. Version 8 marks the id as custom-derived, not time-ordered.
export function deterministicDeliveryEventId(opts: {
  notificationEventId: string;
  dedupKey: string;
  outcome: "succeeded" | "failed";
  attemptAt?: Date;
}): string {
  const attempt =
    opts.outcome === "failed" ? (opts.attemptAt?.toISOString() ?? "") : "";
  return deterministicUuidV8(
    `everr.alert_delivery_event.v1\0${opts.notificationEventId}\0${opts.dedupKey}\0${opts.outcome}\0${attempt}`,
  );
}
