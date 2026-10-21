import type { Span } from "@everr/telemetry-explorer/traces";

// The browser Session and Stream that a Replay can play, plus the browser
// service that stored its Segments. A browser record supplies them directly;
// a backend record has neither, so they come from the browser Client spans of
// its Trace. The SDK writes the envelope on every span it sends, so a browser
// Client span is the only kind of span that carries `session.id`.
export type ReplaySource = {
  sessionId: string;
  streamId: string;
  serviceName: string;
};

const SESSION_ID_ATTRIBUTE = "session.id";
const STREAM_ID_ATTRIBUTE = "everr.recording.stream.id";

function text(attributes: Record<string, string>, key: string): string {
  return attributes[key] ?? "";
}

/**
 * The Session on a single browser record. Backend records carry no
 * `session.id`, so this is null for them.
 */
export function sourceFromAttributes(
  attributes: Record<string, string>,
  serviceName: string,
): ReplaySource | null {
  const sessionId = text(attributes, SESSION_ID_ATTRIBUTE);
  if (!sessionId) return null;
  return {
    sessionId,
    streamId: text(attributes, STREAM_ID_ATTRIBUTE),
    serviceName,
  };
}

function browserClientSpans(spans: Span[]): Span[] {
  return spans.filter(
    (span) =>
      span.spanKind === "Client" &&
      text(span.spanAttributes, SESSION_ID_ATTRIBUTE) !== "",
  );
}

/**
 * The Session, Stream, and browser service of a Trace, taken from its browser
 * Client spans. Every such span must agree on the Session, or there is no
 * Session. They must also agree on the Stream, or there is no Clip: the player
 * shows the Session's Clips instead. A Trace with no browser Client span has
 * no Session, as cron, webhook, and document-load Traces do not.
 */
export function sourceFromClientSpans(spans: Span[]): ReplaySource | null {
  const clients = browserClientSpans(spans);
  if (clients.length === 0) return null;

  const sessions = new Set(
    clients.map((span) => text(span.spanAttributes, SESSION_ID_ATTRIBUTE)),
  );
  if (sessions.size !== 1) return null;

  const streams = new Set(
    clients.map((span) => text(span.spanAttributes, STREAM_ID_ATTRIBUTE)),
  );
  const first = clients[0];
  return {
    sessionId: text(first.spanAttributes, SESSION_ID_ATTRIBUTE),
    streamId:
      streams.size === 1 ? text(first.spanAttributes, STREAM_ID_ATTRIBUTE) : "",
    serviceName: first.serviceName,
  };
}

/**
 * Where the player reads its Session. A browser span uses its own envelope.
 * Otherwise the Trace's browser Client spans supply it, which is how a
 * backend entry (a server function, an API call, a cross-origin call with
 * `traceparent`) opens the Clip of the browser Session that caused it.
 */
export function resolveReplaySource(
  entry: Span | undefined,
  spans: Span[],
): ReplaySource | null {
  if (!entry) return null;
  return (
    sourceFromAttributes(entry.spanAttributes, entry.serviceName) ??
    sourceFromClientSpans(spans)
  );
}
