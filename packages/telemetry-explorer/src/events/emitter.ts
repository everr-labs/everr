// Generic log-event emitter: the single write path for app-emitted events
// stored as plain log rows (ADR 0004). Callers describe the event; backends
// (cloud ClickHouse insert today, local OTLP later) stamp tenant and
// timestamp, so no caller can spoof either.
export interface LogEventInput {
  /** ServiceName of the log row; backends mirror it into resource service.name. */
  serviceName: string;
  /** Log Body. Markdown for error triage events. */
  body: string;
  /** LogAttributes carried by the row. */
  attributes: Record<string, string>;
  /** Extra resource attributes; backends override tenant-identifying keys. */
  resourceAttributes?: Record<string, string>;
  /** Defaults to "INFO". */
  severityText?: string;
  /** Defaults to 9 (INFO). */
  severityNumber?: number;
}

export interface LogEventEmitter {
  emit(event: LogEventInput): Promise<void>;
}
