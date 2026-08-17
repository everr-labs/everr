/**
 * What a channel's recent delivery trail says about it.
 *
 * Client-safe on purpose: the row shape is shared by the ClickHouse read
 * (health-repository.server.ts) and the channel rows that display it, and the
 * reader must not pull the server module into the browser bundle.
 */
export type AlertingChannelHealth = {
  channel: string;
  /** ISO millis of the last delivery that arrived; null if none did. */
  lastSuccessAt: string | null;
  /** ISO millis of the last delivery that failed; null if none did. */
  lastFailureAt: string | null;
  /** Distinct deliveries that arrived in the window. */
  delivered: number;
  /** Distinct deliveries that failed in the window. */
  failed: number;
  /** Sanitized text of the most recent failure; empty when there is none. */
  lastError: string;
};

/** The window every channel-health figure is counted over. */
export const ALERTING_CHANNEL_HEALTH_HOURS = 24;
