import { vi } from "vite-plus/test";
import type * as Sdk from "../index.js";
import type { Instrumentation, WebSDKOptions } from "../index.js";
import type { RecordingOptions } from "../recording.js";

// The shared start of the recording tests. Each start loads the package again,
// so the page-level state (the one recorder per page and the count of
// automatic Clips) begins fresh, as it does on a reload.

type Wire = { key: string; value: Record<string, unknown> };
type WireRecord = {
  eventName: string;
  timeUnixNano: string;
  body?: { stringValue?: string };
  attributes: Wire[];
  traceId?: string;
};
type WireSpan = {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  parentSpanId?: string;
  attributes: Wire[];
};
// oxlint-disable-next-line typescript/no-explicit-any -- Tests walk rrweb event trees whose shape depends on the event type.
export type RrwebEvent = { type: number; timestamp: number; data: Record<string, any> };

const flat = (attributes: Wire[]) =>
  Object.fromEntries(attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
const ms = (nanos: string) => Number(BigInt(nanos) / 1_000_000n);

export type Started = Awaited<ReturnType<typeof start>>;

export async function start(
  options: RecordingOptions = {},
  {
    extra = () => [],
    rate,
    sdkOptions = {},
    settle = true,
  }: {
    extra?: (sdk: typeof Sdk) => Instrumentation[];
    /** Wraps the recording in `sampled()` with this rate. */
    rate?: number;
    sdkOptions?: Partial<WebSDKOptions>;
    settle?: boolean;
  } = {},
) {
  vi.resetModules();
  const sdk = await import("../index.js");
  const rec = await import("../recording.js");
  const sent: { signal: string; body: string }[] = [];
  const client = new sdk.WebSDK({
    serviceName: "recording-test",
    persistence: "memory",
    send: (signal, body) => void sent.push({ signal, body }),
    ...sdkOptions,
    instrumentations: [
      rate === undefined ? rec.recording(options) : sdk.sampled(rec.recording(options), rate),
      ...extra(sdk),
    ],
  });
  if (settle) await vi.dynamicImportSettled();

  const records = (): WireRecord[] =>
    sent
      .filter((s) => s.signal === "logs")
      .flatMap((s) => JSON.parse(s.body).resourceLogs[0].scopeLogs[0].logRecords);
  /** The Segments in send order. A piece of a large event has no `events`. */
  const segments = () =>
    records()
      .filter((r) => r.eventName === "everr.browser.recording.segment")
      .map((r) => {
        const attrs = flat(r.attributes);
        const body = r.body?.stringValue ?? "";
        const piece = attrs["everr.recording.event.pieces"] !== undefined;
        return {
          attrs,
          body,
          time: ms(r.timeUnixNano),
          traceId: r.traceId,
          events: piece ? [] : (JSON.parse(body) as RrwebEvent[]),
        };
      });
  const spans = async () => {
    await client.flush();
    return sent
      .filter((s) => s.signal === "traces")
      .flatMap((s): WireSpan[] => JSON.parse(s.body).resourceSpans[0].scopeSpans[0].spans)
      .filter((s) => s.name === "recording")
      .map((s) => ({
        ...s,
        attrs: flat(s.attributes),
        start: ms(s.startTimeUnixNano),
        end: ms(s.endTimeUnixNano),
      }));
  };
  const logs = async () => {
    await client.flush();
    return records()
      .filter((r) => r.eventName !== "everr.browser.recording.segment")
      .map((r) => ({ eventName: r.eventName, attrs: flat(r.attributes) }));
  };
  /** The events of one Clip, in Segment order. */
  const clipEvents = (clipId: string) =>
    reassemble(segments().filter((s) => s.attrs["everr.recording.clip.id"] === clipId));

  return { sdk, rec, client, sent, segments, spans, logs, clipEvents };
}

/**
 * The events of Segments in index order, as a reader gets them: the pieces of
 * a large event are joined in piece order, and the whole text is parsed once.
 */
export function reassemble(
  segments: { attrs: Record<string, unknown>; body: string; events: RrwebEvent[] }[],
): RrwebEvent[] {
  const ordered = [...segments].sort(
    (a, b) =>
      Number(a.attrs["everr.recording.segment.index"]) -
      Number(b.attrs["everr.recording.segment.index"]),
  );
  const events: RrwebEvent[] = [];
  const open = new Map<string, string[]>();
  for (const s of ordered) {
    const count = s.attrs["everr.recording.event.pieces"];
    if (count === undefined) {
      events.push(...s.events);
      continue;
    }
    const key = String(s.attrs["everr.recording.event.index"]);
    const parts = open.get(key) ?? [];
    parts[Number(s.attrs["everr.recording.event.piece"])] = s.body;
    open.set(key, parts);
    if (parts.filter((p) => p !== undefined).length === Number(count)) {
      events.push(JSON.parse(parts.join("")) as RrwebEvent);
      open.delete(key);
    }
  }
  return events;
}

/** Lets the MutationObserver callbacks run, so rrweb emits the pending mutations. */
export const mutations = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

export const FULL_SNAPSHOT = 2;
export const INCREMENTAL = 3;
export const META = 4;
export const CUSTOM = 5;
