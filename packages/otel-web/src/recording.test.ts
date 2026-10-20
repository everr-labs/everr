import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSDK } from "./client.js";
import { hashUnit } from "./instrumentations/sampled.js";
import { logger } from "./logger.js";
import {
  emitRecording,
  markRecording,
  pauseRecording,
  recording,
  resumeRecording,
} from "./recording.js";
import { clearIdentity } from "./state/session.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  type OtlpSpan,
  startClient,
  startPersistentClient,
} from "./test-kit.js";
import { tracer } from "./tracer.js";

// rrweb captures Date.now once, when its module evaluates. This spy is
// installed before that import and is never restored, so event timestamps
// follow `clock`.
const realNow = Date.now;
const clock = { now: realNow() };
vi.spyOn(Date, "now").mockImplementation(() => clock.now);

const SEGMENT = "everr.browser.recording.segment";
const MARK = "everr.browser.recording.mark";
const SEGMENT_BYTES = 950 * 1024;

const clients: WebSDK[] = [];

beforeEach(() => {
  clock.now = realNow();
});

afterEach(async () => {
  while (clients.length) await clients.pop()?.shutdown();
  clearIdentity();
  document.body.replaceChildren();
});

function track(sdk: WebSDK): WebSDK {
  clients.push(sdk);
  return sdk;
}

async function recorderReady(): Promise<void> {
  await import("./recording/recorder.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function tick(ms: number): void {
  clock.now += ms;
}

async function addText(text: string): Promise<HTMLElement> {
  const el = document.createElement("p");
  el.textContent = text;
  document.body.append(el);
  await settle();
  return el;
}

function bodyText(record: OtlpRecord): string {
  const body = record.body as { stringValue?: string } | undefined;
  return body?.stringValue ?? "";
}

function eventsOf(
  record: OtlpRecord,
): Array<{ type: number; timestamp: number }> {
  return JSON.parse(bodyText(record)) as Array<{
    type: number;
    timestamp: number;
  }>;
}

function segmentBatches(batches: OtlpBatch[]): OtlpBatch[] {
  return batches.filter((batch) =>
    batch.records.some((record) => record.eventName === SEGMENT),
  );
}

function segmentRecords(batches: OtlpBatch[]): OtlpRecord[] {
  return segmentBatches(batches).flatMap((batch) => batch.records);
}

function clipEvents(
  batches: OtlpBatch[],
): Array<{ type: number; timestamp: number }> {
  return segmentRecords(batches)
    .slice()
    .sort(
      (a, b) =>
        Number(attrs(a)["everr.recording.segment.index"]) -
        Number(attrs(b)["everr.recording.segment.index"]),
    )
    .flatMap(eventsOf);
}

function recordingSpan(batches: OtlpBatch[]): OtlpSpan | undefined {
  return batches
    .flatMap((batch) => batch.spans)
    .find((span) => span.name === "recording");
}

function recordingSpans(batches: OtlpBatch[]): OtlpSpan[] {
  return batches
    .flatMap((batch) => batch.spans)
    .filter((span) => span.name === "recording");
}

function markLogs(batches: OtlpBatch[]): OtlpRecord[] {
  return batches
    .flatMap((batch) => batch.records)
    .filter((record) => record.eventName === MARK);
}

function ms(nano: string): number {
  return Number(BigInt(nano) / 1_000_000n);
}

function sessionFor(sampled: boolean, rate: number): string {
  for (let i = 0; i < 20_000; i++) {
    const id = `${1_700_000_000_000 + i}-${String(1_000_000_000_000 + i)}`;
    if (hashUnit(`${id}:recording`) < rate === sampled) return id;
  }
  throw new Error("no session id for the sampling oracle");
}

function seedSession(id: string): void {
  clearIdentity();
  localStorage.setItem("everr.visitor.id", "visitor-recording");
  localStorage.setItem("everr.session", JSON.stringify({ id, t: Date.now() }));
}

describe("recording", () => {
  it("sends nothing until emitRecording, and a call before the chunk loads does nothing", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    emitRecording();
    await recorderReady();
    expect(segmentRecords(batches)).toEqual([]);
    emitRecording();
    await sdk.flush();
    expect(segmentRecords(batches).length).toBeGreaterThan(0);
    expect(recordingSpan(batches)?.name).toBe("recording");
  });

  it("does nothing when the Session is not sampled", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ sampleRate: 0 })],
    });
    track(sdk);
    await recorderReady();
    logger.info("outside");
    emitRecording();
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    const log = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "outside");
    expect(log).toBeDefined();
    expect(attrs(log!)["everr.recording.stream.id"]).toBeUndefined();
  });

  it("records a Session when sampleRate is omitted", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    emitRecording();
    await sdk.flush();
    expect(segmentRecords(batches).length).toBeGreaterThan(0);
  });

  it("samples with hashUnit over sessionId:recording", async () => {
    const rate = 0.5;
    const keptId = sessionFor(true, rate);
    seedSession(keptId);
    const [kept, keptBatches] = startPersistentClient({
      instrumentations: [recording({ sampleRate: rate })],
    });
    track(kept);
    await recorderReady();
    emitRecording();
    expect(segmentRecords(keptBatches).length).toBeGreaterThan(0);
    expect(attrs(segmentRecords(keptBatches)[0]!)["session.id"]).toBe(keptId);

    await kept.shutdown();
    clients.pop();

    const droppedId = sessionFor(false, rate);
    seedSession(droppedId);
    const [dropped, droppedBatches] = startPersistentClient({
      instrumentations: [recording({ sampleRate: rate })],
    });
    track(dropped);
    await recorderReady();
    logger.info("not recorded");
    emitRecording();
    await dropped.flush();
    expect(segmentRecords(droppedBatches)).toEqual([]);
    const log = droppedBatches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "not recorded");
    expect(attrs(log!)["session.id"]).toBe(droppedId);
    expect(attrs(log!)["everr.recording.stream.id"]).toBeUndefined();
  });

  it("keeps one recorder when recording() is installed twice", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording(), recording()],
    });
    track(sdk);
    await recorderReady();
    await addText("ONCE");
    emitRecording();
    const events = clipEvents(batches);
    expect(events.filter((event) => event.type === 2)).toHaveLength(1);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body.split("ONCE")).toHaveLength(2);
  });

  it("records again after the first WebSDK shuts down", async () => {
    const [first, firstBatches] = startClient({
      instrumentations: [recording()],
    });
    track(first);
    await recorderReady();
    emitRecording();
    const firstStream = attrs(segmentRecords(firstBatches)[0])[
      "everr.recording.stream.id"
    ];
    await first.shutdown();
    clients.pop();

    const [second, secondBatches] = startClient({
      instrumentations: [recording()],
    });
    track(second);
    await recorderReady();
    emitRecording();
    const secondStream = attrs(segmentRecords(secondBatches)[0])[
      "everr.recording.stream.id"
    ];
    expect(secondStream).toEqual(expect.any(String));
    expect(secondStream).not.toBe(firstStream);
  });

  it("refuses a second recorder while an unsampled recording() holds the page", async () => {
    seedSession(sessionFor(false, 0.5));
    const [first] = startPersistentClient({
      instrumentations: [recording({ sampleRate: 0.5 })],
    });
    track(first);
    await recorderReady();
    const [second, batches] = startClient({ instrumentations: [recording()] });
    track(second);
    await recorderReady();
    emitRecording();
    await second.flush();
    expect(segmentRecords(batches)).toEqual([]);
  });

  it("keeps the last 5 minutes", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    const old = await addText("OLD-MARKER");
    old.remove();
    await settle();
    tick(5 * 60 * 1000 + 1);
    await addText("NEW-MARKER");
    emitRecording();
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).not.toContain("OLD-MARKER");
    expect(body).toContain("NEW-MARKER");
  });

  it("starts a Clip at the last full snapshot at or before the requested start", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    await addText("FIRST");
    tick(10_001);
    await addText("SECOND");
    const checkoutAt = clock.now;
    tick(1_000);
    const requestedStart = clock.now - 500;
    emitRecording({ last: 500 });
    await sdk.flush();
    const events = clipEvents(batches);
    const snapshots = events.filter((event) => event.type === 2);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]?.timestamp).toBe(checkoutAt);
    expect(snapshots[0]?.timestamp).toBeLessThanOrEqual(requestedStart);
    expect(Math.min(...events.map((event) => event.timestamp))).toBe(
      checkoutAt,
    );
    expect(
      events.some(
        (event) => event.type === 4 && event.timestamp === checkoutAt,
      ),
    ).toBe(true);
    const span = recordingSpan(batches);
    expect(span).toBeDefined();
    expect(ms(span!.endTimeUnixNano) - ms(span!.startTimeUnixNano)).toBe(500);
  });

  it("sends the whole buffer when last is omitted, and marks a Clip truncated when it starts late", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    emitRecording();
    await sdk.flush();
    const events = clipEvents(batches);
    const span = recordingSpan(batches);
    expect(ms(span!.startTimeUnixNano)).toBe(events[0]?.timestamp);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBeUndefined();

    tick(1_000);
    emitRecording({ last: 60_000 });
    await sdk.flush();
    const truncated = recordingSpans(batches).at(-1);
    expect(attrs(truncated!)["everr.recording.clip.truncated"]).toBe(true);
    expect(
      ms(truncated!.endTimeUnixNano) - ms(truncated!.startTimeUnixNano),
    ).toBe(60_000);
    const clipId = attrs(truncated!)["everr.recording.clip.id"];
    const truncatedSegments = segmentRecords(batches).filter(
      (record) => attrs(record)["everr.recording.clip.id"] === clipId,
    );
    expect(truncatedSegments.length).toBeGreaterThan(0);
    for (const segment of truncatedSegments) {
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBe(true);
    }
    const wholeId = attrs(span!)["everr.recording.clip.id"];
    for (const segment of segmentRecords(batches)) {
      if (attrs(segment)["everr.recording.clip.id"] !== wholeId) continue;
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBeUndefined();
    }
  });

  it("closes a Segment near 950 KB, indexes from 0, and posts each Segment alone", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    const chunk = "x".repeat(600 * 1024);
    await addText(chunk);
    await addText(chunk);
    await addText("y".repeat(SEGMENT_BYTES));
    emitRecording();
    logger.info("plain log");
    await sdk.flush();

    const segments = segmentRecords(batches);
    expect(segments.length).toBeGreaterThan(1);
    const indexes = segments.map((record) =>
      Number(attrs(record)["everr.recording.segment.index"]),
    );
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(indexes[0]).toBe(0);
    expect(new Set(indexes).size).toBe(indexes.length);
    const clipIds = new Set(
      segments.map((record) => attrs(record)["everr.recording.clip.id"]),
    );
    expect(clipIds.size).toBe(1);

    for (const batch of segmentBatches(batches)) {
      expect(batch.records).toHaveLength(1);
      expect(batch.spans).toEqual([]);
      expect(batch.records[0]?.traceId).toBeUndefined();
    }
    const plain = batches.find((batch) =>
      batch.records.some((record) => bodyText(record) === "plain log"),
    );
    expect(plain).toBeDefined();
    expect(plain!.records.some((record) => record.eventName === SEGMENT)).toBe(
      false,
    );

    let oversized = 0;
    for (const record of segments) {
      const events = eventsOf(record);
      const huge = events.filter(
        (event) => new Blob([JSON.stringify(event)]).size > SEGMENT_BYTES,
      );
      oversized += huge.length;
      if (huge.length > 0) expect(events).toHaveLength(1);
    }
    expect(oversized).toBeGreaterThan(0);
  }, 30_000);

  it("puts the stream id on the envelope while the Stream buffers and clears it when the Stream ends", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    logger.info("during");
    emitRecording();
    await sdk.flush();
    const during = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "during");
    const streamId = attrs(segmentRecords(batches)[0]!)[
      "everr.recording.stream.id"
    ];
    expect(attrs(during!)["everr.recording.stream.id"]).toBe(streamId);
    expect(streamId).toEqual(expect.any(String));

    history.pushState({}, "", "/replay-next");
    logger.info("after navigation");
    await sdk.flush();
    const moved = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "after navigation");
    expect(attrs(moved!)["everr.recording.stream.id"]).toBe(streamId);

    await sdk.shutdown();
    clients.pop();
    const [next, nextBatches] = startClient({ instrumentations: [] });
    track(next);
    logger.info("after end");
    await next.flush();
    const after = nextBatches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "after end");
    expect(attrs(after!)["everr.recording.stream.id"]).toBeUndefined();
  });

  it("emits one root recording span per Clip and does not parent later records", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    tick(2_000);
    emitRecording({ last: 2_000 });
    await sdk.flush();
    const span = recordingSpan(batches);
    expect(span?.parentSpanId).toBeUndefined();
    expect(span?.kind).toBe(1);
    expect(attrs(span!)["everr.recording.trigger"]).toBe("manual");
    const segment = segmentRecords(batches)[0]!;
    expect(attrs(span!)["everr.recording.clip.id"]).toBe(
      attrs(segment)["everr.recording.clip.id"],
    );
    expect(attrs(span!)["everr.recording.stream.id"]).toBe(
      attrs(segment)["everr.recording.stream.id"],
    );
    expect(ms(span!.endTimeUnixNano) - ms(span!.startTimeUnixNano)).toBe(2_000);

    tracer.startSpan("later").end();
    logger.info("later log");
    await sdk.flush();
    const later = batches
      .flatMap((batch) => batch.spans)
      .find((item) => item.name === "later");
    expect(later?.traceId).not.toBe(span?.traceId);
    expect(later?.parentSpanId).not.toBe(span?.spanId);
    const log = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "later log");
    expect(log?.traceId).toBeUndefined();
    expect(log?.spanId).toBeUndefined();
  });

  it("keeps the buffer after a Clip, so a later Clip has its own id", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    emitRecording();
    emitRecording({ last: 1_000 });
    await sdk.flush();
    const spans = batches
      .flatMap((batch) => batch.spans)
      .filter((span) => span.name === "recording");
    expect(spans).toHaveLength(2);
    const ids = spans.map((span) => attrs(span)["everr.recording.clip.id"]);
    expect(ids[0]).not.toBe(ids[1]);
    const groups = new Map<unknown, number[]>();
    for (const record of segmentRecords(batches)) {
      const id = attrs(record)["everr.recording.clip.id"];
      const index = Number(attrs(record)["everr.recording.segment.index"]);
      groups.set(id, [...(groups.get(id) ?? []), index]);
    }
    expect([...groups.keys()]).toEqual(expect.arrayContaining(ids));
    for (const indexes of groups.values()) expect(indexes).toContain(0);
    const snapshots = [...groups.keys()].map((id) =>
      segmentRecords(batches)
        .filter((record) => attrs(record)["everr.recording.clip.id"] === id)
        .flatMap(eventsOf)
        .filter((event) => event.type === 2)
        .map((event) => event.timestamp),
    );
    expect(snapshots[0]?.[0]).toBe(snapshots[1]?.[0]);
  });

  it("writes a mark log in an unsampled Session and does not buffer a Clip", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ sampleRate: 0 })],
    });
    track(sdk);
    await recorderReady();
    markRecording("cart-open");
    logger.info("beside the mark");
    emitRecording({ since: "cart-open" });
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    expect(recordingSpans(batches)).toEqual([]);
    const marks = markLogs(batches);
    expect(marks).toHaveLength(1);
    expect(attrs(marks[0]!)["everr.recording.mark.name"]).toBe("cart-open");
    expect(attrs(marks[0]!)["everr.recording.stream.id"]).toBeUndefined();
    const batch = batches.find((item) =>
      item.records.some((record) => record.eventName === MARK),
    );
    expect(batch?.records.map((record) => record.eventName)).toEqual([
      MARK,
      "",
    ]);
    expect(batch?.records.some((record) => record.eventName === SEGMENT)).toBe(
      false,
    );
  });

  it("emits the mark log before the recorder chunk loads, without a buffer point", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    markRecording("early");
    await recorderReady();
    await addText("AFTER-LOAD");
    emitRecording({ since: "early" });
    await sdk.flush();
    expect(attrs(markLogs(batches)[0]!)["everr.recording.mark.name"]).toBe(
      "early",
    );
    const span = recordingSpan(batches);
    const events = clipEvents(batches);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBe(true);
    expect(ms(span!.startTimeUnixNano)).toBe(events[0]?.timestamp);
    expect(segmentRecords(batches).map(bodyText).join("\n")).toContain(
      "AFTER-LOAD",
    );
    for (const segment of segmentRecords(batches)) {
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBe(true);
    }
  });

  it("replaces a mark with the same name and starts the Clip at the later one", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    const early = await addText("EARLY-MARK");
    markRecording("cart-open");
    const firstMark = clock.now;
    early.remove();
    await settle();
    tick(10_001);
    await addText("LATE-MARK");
    const checkoutAt = clock.now;
    tick(100);
    markRecording("cart-open");
    const secondMark = clock.now;
    tick(50);
    emitRecording({ since: "cart-open" });
    await sdk.flush();
    const events = clipEvents(batches);
    const snapshots = events.filter((event) => event.type === 2);
    expect(snapshots[0]?.timestamp).toBe(checkoutAt);
    expect(snapshots[0]?.timestamp).toBeLessThanOrEqual(secondMark);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).not.toContain("EARLY-MARK");
    expect(body).toContain("LATE-MARK");
    const span = recordingSpan(batches);
    expect(ms(span!.startTimeUnixNano)).toBe(secondMark);
    expect(ms(span!.startTimeUnixNano)).not.toBe(firstMark);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBeUndefined();
    expect(markLogs(batches)).toHaveLength(2);
    const streamId = attrs(segmentRecords(batches)[0]!)[
      "everr.recording.stream.id"
    ];
    expect(attrs(markLogs(batches)[0]!)["everr.recording.stream.id"]).toBe(
      streamId,
    );
  });

  it("accepts an epoch timestamp for since and truncates a start before the buffer", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    const before = await addText("BEFORE-SINCE");
    before.remove();
    await settle();
    tick(10_001);
    await addText("AFTER-SINCE");
    const checkoutAt = clock.now;
    tick(2_000);
    const since = clock.now - 500;
    emitRecording({ since });
    await sdk.flush();
    const inside = clipEvents(batches);
    expect(inside.filter((event) => event.type === 2)[0]?.timestamp).toBe(
      checkoutAt,
    );
    const insideSpan = recordingSpan(batches);
    expect(ms(insideSpan!.startTimeUnixNano)).toBe(since);
    expect(
      ms(insideSpan!.endTimeUnixNano) - ms(insideSpan!.startTimeUnixNano),
    ).toBe(500);
    expect(
      attrs(insideSpan!)["everr.recording.clip.truncated"],
    ).toBeUndefined();
    const insideBody = segmentRecords(batches).map(bodyText).join("\n");
    expect(insideBody).not.toContain("BEFORE-SINCE");
    expect(insideBody).toContain("AFTER-SINCE");

    const early = clock.now - 60_000;
    emitRecording({ since: early });
    await sdk.flush();
    const truncated = recordingSpans(batches).at(-1);
    const events = clipEvents(
      batches.filter((batch) =>
        batch.records.some(
          (record) =>
            attrs(record)["everr.recording.clip.id"] ===
            attrs(truncated!)["everr.recording.clip.id"],
        ),
      ),
    );
    expect(attrs(truncated!)["everr.recording.clip.truncated"]).toBe(true);
    expect(ms(truncated!.startTimeUnixNano)).toBe(early);
    expect(
      ms(truncated!.endTimeUnixNano) - ms(truncated!.startTimeUnixNano),
    ).toBe(60_000);
    expect(events[0]?.timestamp).toBeGreaterThan(early);
    const clipId = attrs(truncated!)["everr.recording.clip.id"];
    const segments = segmentRecords(batches).filter(
      (record) => attrs(record)["everr.recording.clip.id"] === clipId,
    );
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBe(true);
    }
  });

  it("drops a mark when the events at its time leave the buffer", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    markRecording("cart-open");
    const markedAt = clock.now;
    const old = await addText("AGED-MARK");
    old.remove();
    await settle();
    tick(5 * 60 * 1000 + 1);
    await addText("FRESH-MARK");
    emitRecording({ since: "cart-open" });
    await sdk.flush();
    const events = clipEvents(batches);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).not.toContain("AGED-MARK");
    expect(body).toContain("FRESH-MARK");
    const span = recordingSpan(batches);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBe(true);
    expect(ms(span!.startTimeUnixNano)).toBe(events[0]?.timestamp);
    expect(ms(span!.startTimeUnixNano)).toBeGreaterThan(markedAt);
    for (const segment of segmentRecords(batches)) {
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBe(true);
    }
  });

  it("keeps a mark that is still inside the buffer when older events leave", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    const old = await addText("OLD-KEEP");
    old.remove();
    await settle();
    tick(60_000);
    markRecording("kept");
    const keptAt = clock.now;
    await addText("KEPT-MARK");
    tick(5 * 60 * 1000 - 30_000);
    emitRecording({ since: "kept" });
    await sdk.flush();
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).not.toContain("OLD-KEEP");
    expect(body).toContain("KEPT-MARK");
    const span = recordingSpan(batches);
    expect(ms(span!.startTimeUnixNano)).toBe(keptAt);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBeUndefined();
  });

  it("buffers nothing while paused, then takes a full snapshot on resume", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording()] });
    track(sdk);
    await recorderReady();
    await addText("BEFORE-PAUSE");
    pauseRecording();
    pauseRecording();
    const pauseAt = clock.now;
    tick(1_000);
    const secret = await addText("SECRET-PAUSE");
    secret.remove();
    await settle();
    const during = clock.now;
    tick(2_000);
    const resumeAt = clock.now;
    resumeRecording();
    await settle();
    await addText("AFTER-RESUME");
    emitRecording();
    await sdk.flush();
    const events = clipEvents(batches);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).toContain("BEFORE-PAUSE");
    expect(body.split("AFTER-RESUME")).toHaveLength(2);
    expect(body).not.toContain("SECRET-PAUSE");
    expect(
      events.filter(
        (event) => event.type === 2 && event.timestamp === resumeAt,
      ),
    ).toHaveLength(1);
    expect(events.some((event) => event.timestamp === during)).toBe(false);
    expect(
      events.some(
        (event) => event.timestamp > pauseAt && event.timestamp < resumeAt,
      ),
    ).toBe(false);
    expect(events.some((event) => event.timestamp <= pauseAt)).toBe(true);
    expect(events.some((event) => event.timestamp >= resumeAt)).toBe(true);
  });
});

function lastAndSinceAreExclusive(): void {
  emitRecording();
  emitRecording({ last: 1_000 });
  emitRecording({ since: "cart-open" });
  emitRecording({ since: 1_700_000_000_000 });
  // @ts-expect-error - last and since cannot be used together
  emitRecording({ last: 1_000, since: "cart-open" });
}

describe("emitRecording options", () => {
  it("rejects last and since together", () => {
    expect(lastAndSinceAreExclusive).toBeTypeOf("function");
  });
});
