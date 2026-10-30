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
      ...(typeof extra === "function" ? extra(sdk) : extra),
    ],
  });
  if (settle) await vi.dynamicImportSettled();

  const records = (): WireRecord[] =>
    sent
      .filter((s) => s.signal === "logs")
      .flatMap((s) => JSON.parse(s.body).resourceLogs[0].scopeLogs[0].logRecords);
  const segments = () =>
    records()
      .filter((r) => r.eventName === "everr.browser.recording.segment")
      .map((r) => ({
        attrs: flat(r.attributes),
        time: ms(r.timeUnixNano),
        traceId: r.traceId,
        events: JSON.parse(r.body?.stringValue ?? "[]") as RrwebEvent[],
      }));
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
    segments()
      .filter((s) => s.attrs["everr.recording.clip.id"] === clipId)
      .flatMap((s) => s.events);

  return { sdk, rec, client, sent, segments, spans, logs, clipEvents };
}

/** Lets the MutationObserver callbacks run, so rrweb emits the pending mutations. */
export const mutations = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

export const FULL_SNAPSHOT = 2;
export const INCREMENTAL = 3;
export const META = 4;
export const CUSTOM = 5;
