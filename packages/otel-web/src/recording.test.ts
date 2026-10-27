import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { WebSDK } from "./client.js";
import { captureError } from "./errors.js";
import { errors } from "./instrumentations/errors/index.js";
import { network } from "./instrumentations/network/index.js";
import { hashUnit } from "./instrumentations/sampled.js";
import { logger } from "./logger.js";
import { recorder, recording } from "./recording.js";
import { clearIdentity } from "./state/session.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  type OtlpSpan,
  setAppFetch,
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
const SEGMENT_BYTES = 950 * 1024;
const BUFFER_BYTES = 10 * 1024 * 1024;
const MINUTE = 60_000;

const clients: WebSDK[] = [];

beforeEach(() => {
  clock.now = realNow();
});

afterEach(async () => {
  while (clients.length) await clients.pop()?.shutdown();
  clearIdentity();
  setAppFetch(undefined);
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

function eventsOf(record: OtlpRecord): Array<{
  type: number;
  timestamp: number;
  data?: { tag?: string };
}> {
  return JSON.parse(bodyText(record)) as Array<{
    type: number;
    timestamp: number;
    data?: { tag?: string };
  }>;
}

function segmentBatches(batches: OtlpBatch[]): OtlpBatch[] {
  return batches.filter((batch) => batch.records.some((record) => record.eventName === SEGMENT));
}

function segmentRecords(batches: OtlpBatch[]): OtlpRecord[] {
  return segmentBatches(batches).flatMap((batch) => batch.records);
}

function clipEvents(batches: OtlpBatch[]): Array<{
  type: number;
  timestamp: number;
  data?: { tag?: string };
}> {
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
  return recordingSpans(batches)[0];
}

function recordingSpans(batches: OtlpBatch[]): OtlpSpan[] {
  return batches.flatMap((batch) => batch.spans).filter((span) => span.name === "recording");
}

function clipIdsOf(batches: OtlpBatch[]): string[] {
  const ids: string[] = [];
  for (const record of segmentRecords(batches)) {
    const id = String(attrs(record)["everr.recording.clip.id"]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function ms(nano: string): number {
  return Number(BigInt(nano) / 1_000_000n);
}

function sessionFor(sampled: boolean, rate: number): string {
  return sessionsWhere(sampled, rate, 1)[0]!;
}

function sessionsWhere(sampled: boolean, rate: number, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 50_000 && ids.length < count; i++) {
    const id = `${1_700_000_000_000 + i}-${String(1_000_000_000_000 + i)}`;
    if (hashUnit(`${id}:recording`) < rate === sampled) ids.push(id);
  }
  if (ids.length < count) throw new Error("no session id for the sampling oracle");
  return ids;
}

function adoptSession(id: string): void {
  localStorage.setItem("everr.session", JSON.stringify({ id, t: Date.now() }));
  logger.info(`adopt ${id}`);
}

function rawEventBytes(records: OtlpRecord[]): number {
  let total = 0;
  for (const record of records) {
    const events = JSON.parse(bodyText(record)) as unknown[];
    for (const event of events) {
      total += new Blob([JSON.stringify(event)]).size;
    }
  }
  return total;
}

async function stop(sdk: WebSDK): Promise<void> {
  await sdk.shutdown();
  const index = clients.indexOf(sdk);
  if (index >= 0) clients.splice(index, 1);
}

function seedSession(id: string): void {
  clearIdentity();
  localStorage.setItem("everr.visitor.id", "visitor-recording");
  localStorage.setItem("everr.session", JSON.stringify({ id, t: Date.now() }));
}

describe("recording", () => {
  it("sends nothing until emitClip or startClip, and a call before the chunk loads returns an inert handle", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    const earlyAt = clock.now;
    const early = recorder.startClip();
    expect(early.id).toBe("");
    expect(early.startTime).toBe(earlyAt);
    expect(early.isRecording()).toBe(false);
    early.end();
    recorder.emitClip();
    await recorderReady();
    expect(segmentRecords(batches)).toEqual([]);
    recorder.emitClip();
    await sdk.flush();
    expect(segmentRecords(batches).length).toBeGreaterThan(0);
    expect(recordingSpan(batches)?.name).toBe("recording");
  });

  it("does nothing when the Session is not sampled and returns an inert Clip", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ sampleRate: 0 })],
    });
    track(sdk);
    await recorderReady();
    logger.info("outside");
    const clip = recorder.startClip({ last: 5_000 });
    expect(clip.id).toBe("");
    expect(clip.startTime).toBe(clock.now - 5_000);
    expect(clip.isRecording()).toBe(false);
    clip.end();
    recorder.emitClip();
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    const log = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "outside");
    expect(log).toBeDefined();
    expect(attrs(log!)["everr.recording.stream.id"]).toBeUndefined();
  });

  it("records a Session when sampleRate is omitted", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    recorder.emitClip();
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
    recorder.emitClip();
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
    recorder.emitClip();
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
      instrumentations: [recording({ maskAllText: false }), recording({ maskAllText: false })],
    });
    track(sdk);
    await recorderReady();
    await addText("ONCE");
    recorder.emitClip();
    const events = clipEvents(batches);
    expect(events.filter((event) => event.type === 2)).toHaveLength(1);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body.split("ONCE")).toHaveLength(2);
  });

  it("records again after the first WebSDK shuts down", async () => {
    const [first, firstBatches] = startClient({
      instrumentations: [recording({ maskAllText: false })],
    });
    track(first);
    await recorderReady();
    recorder.emitClip();
    const firstStream = attrs(segmentRecords(firstBatches)[0]!)["everr.recording.stream.id"];
    await first.shutdown();
    clients.pop();

    const [second, secondBatches] = startClient({
      instrumentations: [recording({ maskAllText: false })],
    });
    track(second);
    await recorderReady();
    recorder.emitClip();
    const secondStream = attrs(segmentRecords(secondBatches)[0]!)["everr.recording.stream.id"];
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
    recorder.emitClip();
    await second.flush();
    expect(segmentRecords(batches)).toEqual([]);
  });

  it("keeps the last 5 minutes", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    const old = await addText("OLD-MARKER");
    old.remove();
    await settle();
    tick(5 * 60 * 1000 + 1);
    await addText("NEW-MARKER");
    recorder.emitClip();
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).not.toContain("OLD-MARKER");
    expect(body).toContain("NEW-MARKER");
  });

  it("starts a Clip at the last full snapshot at or before the requested start, with a 30-second checkout", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("FIRST");
    tick(30_001);
    await addText("SECOND");
    const checkoutAt = clock.now;
    tick(1_000);
    const requestedStart = clock.now - 500;
    recorder.emitClip({ last: 500 });
    await sdk.flush();
    const events = clipEvents(batches);
    const snapshots = events.filter((event) => event.type === 2);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]?.timestamp).toBe(checkoutAt);
    expect(snapshots[0]?.timestamp).toBeLessThanOrEqual(requestedStart);
    expect(Math.min(...events.map((event) => event.timestamp))).toBe(checkoutAt);
    expect(events.some((event) => event.type === 4 && event.timestamp === checkoutAt)).toBe(true);
    const span = recordingSpan(batches);
    expect(span).toBeDefined();
    expect(ms(span!.endTimeUnixNano) - ms(span!.startTimeUnixNano)).toBe(500);
  });

  it("emitClip() sends the same Clip as startClip().end(), and clip.end() is idempotent", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("HANDLE-CONTENT");
    tick(2_000);
    const clip = recorder.startClip({ last: 1_000 });
    expect(clip.id).toEqual(expect.any(String));
    expect(clip.id.length).toBeGreaterThan(0);
    expect(clip.startTime).toBe(clock.now - 1_000);
    expect(clip.isRecording()).toBe(true);
    expect(recordingSpans(batches)).toHaveLength(0);

    tick(500);
    clip.end();
    expect(clip.isRecording()).toBe(false);
    clip.end();
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(1);
    const span = recordingSpans(batches)[0]!;
    expect(attrs(span)["everr.recording.clip.id"]).toBe(clip.id);
    expect(ms(span.startTimeUnixNano)).toBe(clip.startTime);
    expect(ms(span.endTimeUnixNano)).toBe(clock.now);
  });

  it("startClip({ next: 0 }) closes at once", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    const clip = recorder.startClip({ next: 0 });
    expect(clip.id.length).toBeGreaterThan(0);
    expect(clip.isRecording()).toBe(false);
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(1);
  });

  it("sends the whole buffer when last is omitted, and marks a Clip truncated when it starts late", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    recorder.emitClip();
    await sdk.flush();
    const events = clipEvents(batches);
    const span = recordingSpan(batches);
    expect(ms(span!.startTimeUnixNano)).toBe(events[0]?.timestamp);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBeUndefined();

    tick(1_000);
    recorder.emitClip({ last: 60_000 });
    await sdk.flush();
    const truncated = recordingSpans(batches).at(-1);
    expect(attrs(truncated!)["everr.recording.clip.truncated"]).toBe(true);
    expect(ms(truncated!.endTimeUnixNano) - ms(truncated!.startTimeUnixNano)).toBe(60_000);
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
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    const chunk = "x".repeat(600 * 1024);
    await addText(chunk);
    await addText(chunk);
    await addText("y".repeat(SEGMENT_BYTES));
    recorder.emitClip();
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
    const clipIds = new Set(segments.map((record) => attrs(record)["everr.recording.clip.id"]));
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
    expect(plain!.records.some((record) => record.eventName === SEGMENT)).toBe(false);

    const oversized = segments.filter((record) =>
      eventsOf(record).some((event) => new Blob([JSON.stringify(event)]).size > SEGMENT_BYTES),
    );
    expect(oversized.length).toBeGreaterThan(0);
    for (const record of oversized) {
      expect(eventsOf(record)).toHaveLength(1);
    }
  }, 30_000);

  it("puts the stream id on the envelope while the Stream buffers and clears it when the Stream ends", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    logger.info("during");
    recorder.emitClip();
    await sdk.flush();
    const during = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "during");
    const streamId = attrs(segmentRecords(batches)[0]!)["everr.recording.stream.id"];
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
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    tick(2_000);
    recorder.emitClip({ last: 2_000 });
    await sdk.flush();
    const span = recordingSpan(batches);
    expect(span?.parentSpanId).toBeUndefined();
    expect(span?.kind).toBe(1);
    expect(attrs(span!)["everr.recording.trigger"]).toBe("manual");
    const segment = segmentRecords(batches)[0]!;
    expect(attrs(span!)["everr.recording.clip.id"]).toBe(attrs(segment)["everr.recording.clip.id"]);
    expect(attrs(span!)["everr.recording.stream.id"]).toBe(
      attrs(segment)["everr.recording.stream.id"],
    );
    expect(ms(span!.endTimeUnixNano) - ms(span!.startTimeUnixNano)).toBe(2_000);

    tracer.startSpan("later").end();
    logger.info("later log");
    await sdk.flush();
    const later = batches.flatMap((batch) => batch.spans).find((item) => item.name === "later");
    expect(later?.traceId).not.toBe(span?.traceId);
    expect(later?.parentSpanId).not.toBe(span?.spanId);
    const log = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "later log");
    expect(log?.traceId).toBeUndefined();
    expect(log?.spanId).toBeUndefined();
  });

  it("keeps the buffer after a Clip, so a later Clip has its own id", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    recorder.emitClip();
    recorder.emitClip({ last: 1_000 });
    await sdk.flush();
    const spans = recordingSpans(batches);
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

  it("drops the oldest events when the buffer passes 10 MB and starts the Clip at a full snapshot", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    const chunk = "z".repeat(1024 * 1024);
    const oldest = await addText("OLDEST-MARKER");
    oldest.remove();
    for (let i = 0; i < 11; i++) {
      const filled = await addText(`${i}:${chunk}`);
      filled.remove();
    }
    // The cap has dropped the first snapshot. A later checkout gives the Clip
    // the full snapshot it must start on.
    tick(30_001);
    await addText("NEWEST-MARKER");
    recorder.emitClip();
    await sdk.flush();
    const records = segmentRecords(batches);
    const body = records.map(bodyText).join("\n");
    expect(body).not.toContain("OLDEST-MARKER");
    expect(body).toContain("NEWEST-MARKER");
    const bytes = rawEventBytes(records);
    expect(bytes).toBeLessThanOrEqual(BUFFER_BYTES);
    const events = clipEvents(batches);
    const firstPlayable = events.find((event) => event.type !== 4);
    expect(firstPlayable?.type).toBe(2);
    expect(events[0]?.type).toBe(4);
    const span = recordingSpan(batches);
    expect(attrs(span!)["everr.recording.clip.truncated"]).toBe(true);
    for (const segment of records) {
      expect(attrs(segment)["everr.recording.clip.truncated"]).toBe(true);
    }
  }, 60_000);

  it("returns an inert handle when the buffer has no full snapshot", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    const chunk = "z".repeat(1024 * 1024);
    for (let i = 0; i < 11; i++) {
      const filled = await addText(`${i}:${chunk}`);
      filled.remove();
    }
    const clip = recorder.startClip();
    expect(clip.id).toBe("");
    expect(clip.isRecording()).toBe(false);
    clip.end();
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    expect(recordingSpans(batches)).toEqual([]);
  }, 60_000);

  it("puts one event over 950 KB in a Segment by itself", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("a".repeat(SEGMENT_BYTES));
    await addText("between");
    await addText("b".repeat(SEGMENT_BYTES));
    recorder.emitClip();
    const oversized = segmentRecords(batches)
      .map(eventsOf)
      .filter((events) =>
        events.some((event) => new Blob([JSON.stringify(event)]).size > SEGMENT_BYTES),
      );
    expect(oversized.length).toBeGreaterThanOrEqual(2);
    for (const events of oversized) expect(events).toHaveLength(1);
  }, 30_000);

  it("throttles attribute mutations per node and refills at 10 per second while leaving adds, removes, and texts untouched", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [
        recording({ maskAllText: false, blockAllMedia: false, maskAttributes: [] }),
      ],
    });
    track(sdk);
    await recorderReady();

    const box = document.createElement("div");
    document.body.append(box);
    await settle();

    for (let i = 0; i < 120; i++) {
      box.setAttribute("data-step", `step-${i}`);
      await settle();
    }

    // Refill 10 tokens after 1 second.
    tick(1_000);
    for (let i = 0; i < 15; i++) {
      box.setAttribute("data-refill", `refill-${i}`);
      await settle();
    }

    // SVG descendants share the nearest <svg> ancestor's bucket.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const rectA = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const rectB = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    svg.append(rectA, rectB);
    document.body.append(svg);
    await settle();

    for (let i = 0; i < 60; i++) {
      rectA.setAttribute("x", `svg-a-${i}`);
      await settle();
      rectB.setAttribute("y", `svg-b-${i}`);
      await settle();
    }

    // Text mutations and adds pass through even when box's attribute bucket is empty.
    box.setAttribute("data-blocked", "NEVER-SEEN");
    const child = document.createElement("span");
    child.textContent = "ADDED-CHILD-KEPT";
    box.append(child);
    await settle();

    recorder.emitClip();
    await sdk.flush();

    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).toContain("step-0");
    expect(body).toContain("step-99");
    expect(body).not.toContain("step-100");
    expect(body).not.toContain("step-119");

    expect(body).toContain("refill-0");
    expect(body).toContain("refill-9");
    expect(body).not.toContain("refill-10");

    // 50 on rectA + 50 on rectB = 100 tokens on the shared <svg>; 50..59 on both are dropped.
    expect(body).toContain("svg-a-49");
    expect(body).toContain("svg-b-49");
    expect(body).not.toContain("svg-a-50");
    expect(body).not.toContain("svg-b-50");

    expect(body).not.toContain("NEVER-SEEN");
    expect(body).toContain("ADDED-CHILD-KEPT");
  });

  it("stops the recorder on an event over 10 MB, marks everr.recording.oversized, keeps earlier history, and resumes on recorder.resume()", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("BEFORE-OVERSIZED");

    // Multi-byte UTF-8: 4 million 3-byte characters = 12 MB UTF-8 (> 10 MB), even though string.length is 4M.
    const huge = await addText("\u20ac".repeat(4 * 1024 * 1024));
    huge.remove();
    await settle();

    // Recorder is now stopped; subsequent mutations are ignored.
    await addText("IGNORED-AFTER-OVERSIZED");

    recorder.emitClip();
    await sdk.flush();

    const events = clipEvents(batches);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).toContain("BEFORE-OVERSIZED");
    expect(body).not.toContain("IGNORED-AFTER-OVERSIZED");
    expect(body).not.toContain("\u20ac\u20ac\u20ac");
    expect(
      events.some((event) => event.type === 5 && event.data?.tag === "everr.recording.oversized"),
    ).toBe(true);

    // recorder.resume() tries again with a fresh full snapshot.
    tick(1_000);
    recorder.resume();
    await settle();
    await addText("AFTER-OVERSIZED-RESUME");
    recorder.emitClip({ last: 500 });
    await sdk.flush();

    const latestId = attrs(recordingSpans(batches).at(-1)!)["everr.recording.clip.id"];
    const latestBody = segmentRecords(batches)
      .filter((record) => attrs(record)["everr.recording.clip.id"] === latestId)
      .map(bodyText)
      .join("\n");
    expect(latestBody).toContain("AFTER-OVERSIZED-RESUME");
  }, 60_000);

  it("starts a new Stream when the Session changes and never mixes the two in a Clip", async () => {
    const rate = 0.5;
    const [firstId, secondId] = sessionsWhere(true, rate, 2);
    const [droppedId] = sessionsWhere(false, rate, 1);
    seedSession(firstId!);
    const [sdk, batches] = startPersistentClient({
      instrumentations: [recording({ sampleRate: rate, maskAllText: false })],
    });
    track(sdk);
    await recorderReady();
    const old = await addText("SESSION-ONE");
    recorder.emitClip();
    await sdk.flush();
    const firstSegments = segmentRecords(batches);
    const firstStream = attrs(firstSegments[0]!)["everr.recording.stream.id"];
    expect(attrs(firstSegments[0]!)["session.id"]).toBe(firstId);
    old.remove();
    await settle();

    adoptSession(droppedId!);
    await settle();
    const afterDrop = segmentRecords(batches).length;
    recorder.emitClip();
    await sdk.flush();
    expect(segmentRecords(batches)).toHaveLength(afterDrop);
    const quiet = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === `adopt ${droppedId}`);
    expect(attrs(quiet!)["session.id"]).toBe(droppedId);
    expect(attrs(quiet!)["everr.recording.stream.id"]).toBeUndefined();

    tick(1_000);
    const switchedAt = clock.now;
    adoptSession(secondId!);
    await recorderReady();
    await addText("SESSION-TWO");
    recorder.emitClip();
    await sdk.flush();
    const clipId = attrs(recordingSpans(batches).at(-1)!)["everr.recording.clip.id"];
    const clipRecords = segmentRecords(batches).filter(
      (record) => attrs(record)["everr.recording.clip.id"] === clipId,
    );
    const events = clipRecords.flatMap(eventsOf);
    const body = clipRecords.map(bodyText).join("\n");
    expect(body).toContain("SESSION-TWO");
    expect(body).not.toContain("SESSION-ONE");
    expect(events.some((event) => event.type === 2)).toBe(true);
    for (const event of events) {
      expect(event.timestamp).toBeGreaterThanOrEqual(switchedAt);
    }
    for (const record of clipRecords) {
      expect(attrs(record)["session.id"]).toBe(secondId);
      expect(attrs(record)["everr.recording.stream.id"]).not.toBe(firstStream);
    }
    const span = recordingSpans(batches).at(-1)!;
    expect(attrs(span)["session.id"]).toBe(secondId);
    expect(attrs(span)["everr.recording.stream.id"]).toBe(
      attrs(clipRecords[0]!)["everr.recording.stream.id"],
    );
  });

  it("does not send a Clip from a Session the page has cleared and returns an inert handle", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("OLD-CONSENT");
    clearIdentity();
    const clip = recorder.startClip();
    expect(clip.id).toBe("");
    expect(clip.isRecording()).toBe(false);
    clip.end();
    recorder.emitClip();
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    expect(recordingSpans(batches)).toEqual([]);
  });

  it("takes session.id from the Stream without reading or extending the Session", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ maskAllText: false })],
    });
    track(sdk);
    await recorderReady();
    logger.info("born");
    await sdk.flush();
    const born = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "born");
    const id = attrs(born!)["session.id"];
    expect(id).toEqual(expect.any(String));

    tick(30 * MINUTE + 1);
    await addText("still-here");
    recorder.emitClip();
    await sdk.flush();

    const segment = segmentRecords(batches).at(-1)!;
    const span = recordingSpans(batches).at(-1)!;
    expect(attrs(segment)["session.id"]).toBe(id);
    expect(attrs(span)["session.id"]).toBe(id);

    logger.info("wake");
    await sdk.flush();
    const wake = batches
      .flatMap((batch) => batch.records)
      .find((record) => bodyText(record) === "wake");
    expect(attrs(wake!)["session.id"]).not.toBe(id);
  });

  it("samples a share of Sessions that matches sampleRate", async () => {
    const rate = 0.5;
    const total = 100;
    let recorded = 0;
    for (let i = 0; i < total; i++) {
      const id = `${1_700_000_000_000 + i}-${String(1_000_000_000_000 + i)}`;
      seedSession(id);
      const [sdk, batches] = startPersistentClient({
        instrumentations: [recording({ sampleRate: rate })],
      });
      track(sdk);
      await recorderReady();
      logger.info("probe");
      await sdk.flush();
      const probe = batches
        .flatMap((batch) => batch.records)
        .find((record) => bodyText(record) === "probe");
      if (attrs(probe!)["everr.recording.stream.id"] !== undefined) recorded++;
      await stop(sdk);
    }
    expect(recorded / total).toBeGreaterThan(rate - 0.1);
    expect(recorded / total).toBeLessThan(rate + 0.1);
  }, 60_000);

  it("makes the same sampling decision after a reload and in another tab", async () => {
    const rate = 0.5;
    const keptId = sessionFor(true, rate);
    const droppedId = sessionFor(false, rate);

    const decide = async (id: string): Promise<boolean> => {
      seedSession(id);
      const [sdk, batches] = startPersistentClient({
        instrumentations: [recording({ sampleRate: rate })],
      });
      track(sdk);
      await recorderReady();
      logger.info("probe");
      await sdk.flush();
      const probe = batches
        .flatMap((batch) => batch.records)
        .find((record) => bodyText(record) === "probe");
      const recorded = attrs(probe!)["everr.recording.stream.id"] !== undefined;
      expect(attrs(probe!)["session.id"]).toBe(id);
      await stop(sdk);
      return recorded;
    };

    const first = await decide(keptId);
    const reloaded = await decide(keptId);
    const otherTab = await decide(keptId);
    expect(first).toBe(true);
    expect(reloaded).toBe(first);
    expect(otherTab).toBe(first);

    const skipped = await decide(droppedId);
    const skippedAgain = await decide(droppedId);
    expect(skipped).toBe(false);
    expect(skippedAgain).toBe(false);
  });

  it("buffers nothing while paused, then takes a full snapshot on resume", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await recorderReady();
    await addText("BEFORE-PAUSE");
    recorder.pause();
    recorder.pause();
    const pauseAt = clock.now;
    tick(1_000);
    const secret = await addText("SECRET-PAUSE");
    secret.remove();
    await settle();
    const during = clock.now;
    tick(2_000);
    const resumeAt = clock.now;
    recorder.resume();
    recorder.resume();
    await settle();
    await addText("AFTER-RESUME");
    recorder.emitClip();
    await sdk.flush();
    const events = clipEvents(batches);
    const body = segmentRecords(batches).map(bodyText).join("\n");
    expect(body).toContain("BEFORE-PAUSE");
    expect(body.split("AFTER-RESUME")).toHaveLength(2);
    expect(body).not.toContain("SECRET-PAUSE");
    expect(events.filter((event) => event.type === 2 && event.timestamp === resumeAt)).toHaveLength(
      1,
    );
    expect(events.some((event) => event.timestamp === during)).toBe(false);
    expect(events.some((event) => event.timestamp > pauseAt && event.timestamp < resumeAt)).toBe(
      false,
    );
    expect(events.some((event) => event.timestamp <= pauseAt)).toBe(true);
    expect(events.some((event) => event.timestamp >= resumeAt)).toBe(true);
    const pauseMarker = events.filter(
      (event) => event.type === 5 && event.data?.tag === "everr.recording.pause",
    );
    expect(pauseMarker).toHaveLength(1);
    expect(pauseMarker[0]?.timestamp).toBe(pauseAt);
    const resumeMarker = events.filter(
      (event) => event.type === 5 && event.data?.tag === "everr.recording.resume",
    );
    expect(resumeMarker).toHaveLength(1);
    expect(resumeMarker[0]?.timestamp).toBe(resumeAt);
  });
});

// rrweb's checkout follows Date.now, while a tail closes on setTimeout. The
// two clocks have to move together, in steps small enough that a timer sees
// the time it was scheduled for and not the end of a long jump.
const TIMER_STEP_MS = 250;

async function advance(ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const jump = Math.min(TIMER_STEP_MS, left);
    clock.now += jump;
    await vi.advanceTimersByTimeAsync(jump);
    left -= jump;
  }
}

async function ready(): Promise<void> {
  await import("./recording/recorder.js");
  await vi.advanceTimersByTimeAsync(0);
}

async function mutate(text: string): Promise<void> {
  const el = document.createElement("p");
  el.textContent = text;
  document.body.append(el);
  await vi.advanceTimersByTimeAsync(0);
}

function dispatchError(error: Error, filename?: string): void {
  const swallow = (event: Event) => event.preventDefault();
  window.addEventListener("error", swallow);
  try {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error,
        message: error.message,
        filename,
        cancelable: true,
      }),
    );
  } finally {
    window.removeEventListener("error", swallow);
  }
}

class FakeXHR extends EventTarget {
  readyState = 0;
  status = 0;
  responseHeaders = new Headers();

  open(method: string, url: string | URL) {
    void method;
    void url;
    this.status = 0;
    this.readyState = 1;
    this.dispatchEvent(new Event("readystatechange"));
  }

  setRequestHeader() {}

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name);
  }

  send() {}

  complete(status = 200, event = "load") {
    this.status = status;
    this.readyState = 4;
    this.dispatchEvent(new Event("readystatechange"));
    this.dispatchEvent(new Event(event));
  }
}

describe("automatic Clips and next", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  });

  it("sends the buffered part at once and closes a tail Segment every 5 seconds", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await ready();
    await mutate("BEFORE");
    const start = clock.now;
    const clip = recorder.startClip({ last: 1_000, next: 12_000 });
    expect(clip.isRecording()).toBe(true);

    const first = segmentRecords(batches);
    expect(first.length).toBeGreaterThan(0);
    expect(first.map(bodyText).join("\n")).toContain("BEFORE");
    expect(first.map(bodyText).join("\n")).not.toContain("MID");
    expect(recordingSpans(batches)).toHaveLength(0);

    await advance(1_000);
    await mutate("MID");
    expect(segmentRecords(batches)).toHaveLength(first.length);

    await advance(4_000);
    const mid = segmentRecords(batches);
    expect(mid).toHaveLength(first.length + 1);
    expect(bodyText(mid.at(-1)!)).toContain("MID");
    expect(Number(attrs(mid.at(-1)!)["everr.recording.segment.index"])).toBe(first.length);

    await advance(1_000);
    await mutate("LATE");
    await advance(4_000);
    const late = segmentRecords(batches);
    expect(late).toHaveLength(first.length + 2);
    expect(bodyText(late.at(-1)!)).toContain("LATE");
    expect(recordingSpans(batches)).toHaveLength(0);

    await advance(2_000);
    expect(clip.isRecording()).toBe(false);
    await sdk.flush();
    const span = recordingSpans(batches)[0];
    expect(span).toBeDefined();
    expect(attrs(span!)["everr.recording.trigger"]).toBe("manual");
    expect(ms(span!.startTimeUnixNano)).toBe(start - 1_000);
    expect(ms(span!.endTimeUnixNano)).toBe(start + 12_000);
  });

  it("caps next at 60 seconds and closes an unended startClip() at the 60-second cap", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await ready();
    const start = clock.now;
    const unended = recorder.startClip({ last: 2_000 });
    expect(unended.isRecording()).toBe(true);
    await advance(60_000);
    expect(unended.isRecording()).toBe(false);
    await sdk.flush();
    const span = recordingSpans(batches)[0];
    expect(ms(span!.startTimeUnixNano)).toBe(start - 2_000);
    expect(ms(span!.endTimeUnixNano)).toBe(start + 60_000);

    const cappedStart = clock.now;
    recorder.startClip({ last: 1_000, next: 90_000 });
    await advance(60_000);
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(2);
    expect(ms(recordingSpans(batches)[1]!.endTimeUnixNano)).toBe(cappedStart + 60_000);
  });

  it("emits an error Clip of the last 60 seconds plus 10, and not a filtered error or a trigger before the chunk loads", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [
        recording({ maskAllText: false }),
        errors({
          ignore: ["ignored-noise"],
          denyUrls: ["cdn.blocked.example"],
        }),
      ],
    });
    track(sdk);
    captureError(new Error("too-early"));
    await ready();
    expect(segmentRecords(batches)).toEqual([]);

    captureError(new Error("ignored-noise"));
    dispatchError(new Error("ignored-noise"));
    const denied = new Error("blocked");
    denied.stack = "Error: blocked\n    at go (https://cdn.blocked.example/a.js:1:1)";
    captureError(denied);
    await advance(10_000);
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    expect(recordingSpans(batches)).toEqual([]);

    const triggerAt = clock.now;
    dispatchError(new Error("boom-window"));
    expect(segmentRecords(batches).length).toBeGreaterThan(0);
    expect(recordingSpans(batches)).toHaveLength(0);

    await advance(10_000);
    await sdk.flush();
    const span = recordingSpans(batches)[0];
    expect(attrs(span!)["everr.recording.trigger"]).toBe("error");
    expect(span?.parentSpanId).toBeUndefined();
    expect(ms(span!.startTimeUnixNano)).toBe(triggerAt - 60_000);
    expect(ms(span!.endTimeUnixNano)).toBe(triggerAt + 10_000);
    expect(attrs(span!)["everr.recording.clip.id"]).toBe(
      attrs(segmentRecords(batches)[0]!)["everr.recording.clip.id"],
    );
  });

  it("ignores a trigger that arrives while an automatic Clip is open, without extending the tail", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ maskAllText: false }), errors(), network()],
    });
    track(sdk);
    await ready();
    const t0 = clock.now;
    captureError(new Error("first"));
    await advance(4_000);
    setAppFetch(() => new Response(null, { status: 500 }));
    await fetch("/api/broken");
    await advance(6_000);
    await sdk.flush();

    expect(clipIdsOf(batches)).toHaveLength(1);
    expect(recordingSpans(batches)).toHaveLength(1);
    const span = recordingSpans(batches)[0]!;
    expect(attrs(span)["everr.recording.trigger"]).toBe("error");
    expect(ms(span.startTimeUnixNano)).toBe(t0 - 60_000);
    expect(ms(span.endTimeUnixNano)).toBe(t0 + 10_000);
  });

  it("keeps at most 5 automatic Clips per page, resets on reload, and does not block or count manual Clips", async () => {
    const [sdk, batches] = startPersistentClient({
      instrumentations: [recording({ maskAllText: false }), errors()],
    });
    track(sdk);
    await ready();
    recorder.emitClip();
    recorder.emitClip({ last: 1_000 });
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(2);

    for (let i = 0; i < 5; i++) {
      captureError(new Error(`auto-${i}`));
      await advance(10_000);
    }
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(7);
    const blockedAt = segmentRecords(batches).length;

    captureError(new Error("sixth"));
    await advance(10_000);
    await sdk.flush();
    expect(segmentRecords(batches)).toHaveLength(blockedAt);
    expect(recordingSpans(batches)).toHaveLength(7);

    // Manual Clips still work past the automatic cap.
    recorder.emitClip();
    await sdk.flush();
    expect(recordingSpans(batches)).toHaveLength(8);
    expect(attrs(recordingSpans(batches).at(-1)!)["everr.recording.trigger"]).toBe("manual");

    // Reload starts a fresh automatic cap of 5 even in the same Session.
    const raw = localStorage.getItem("everr.session");
    const visitor = localStorage.getItem("everr.visitor.id");
    await sdk.shutdown();
    clients.pop();
    clearIdentity();
    localStorage.setItem("everr.visitor.id", visitor ?? "");
    localStorage.setItem("everr.session", raw ?? "");

    const [reloaded, reloadedBatches] = startPersistentClient({
      instrumentations: [recording({ maskAllText: false }), errors()],
    });
    track(reloaded);
    await ready();
    captureError(new Error("after-reload"));
    await advance(10_000);
    await reloaded.flush();
    expect(recordingSpans(reloadedBatches)).toHaveLength(1);
    expect(attrs(recordingSpans(reloadedBatches)[0]!)["everr.recording.trigger"]).toBe("error");
  });

  it("keeps manual Clips independent of open automatic Clips", async () => {
    const [sdk, batches] = startClient({
      instrumentations: [recording({ maskAllText: false }), errors()],
    });
    track(sdk);
    await ready();
    recorder.startClip({ next: 10_000 });
    recorder.startClip({ next: 10_000 });
    captureError(new Error("beside-the-manuals"));
    expect(clipIdsOf(batches)).toHaveLength(3);
    await advance(10_000);
    await sdk.flush();
    expect(
      recordingSpans(batches)
        .map((span) => attrs(span)["everr.recording.trigger"])
        .filter((trigger): trigger is string => typeof trigger === "string")
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(["error", "manual", "manual"]);
  });

  it("does not patch fetch, so a failed request alone sends no Clip", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await ready();
    const installed = fetch;
    setAppFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetch("/api/orders")).rejects.toThrow("Failed to fetch");
    expect(fetch).toBe(installed);
    await advance(10_000);
    await sdk.flush();
    expect(segmentRecords(batches)).toEqual([]);
    expect(recordingSpans(batches)).toEqual([]);
  });

  it("sends a network Clip for a 5xx or no response, and never for a 4xx or an abort", async () => {
    const nativeXHR = globalThis.XMLHttpRequest;
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    try {
      const [sdk, batches] = startClient({
        instrumentations: [recording({ maskAllText: false }), network()],
      });
      track(sdk);
      await ready();

      setAppFetch(() => new Response(null, { status: 404 }));
      await fetch("/api/missing");
      setAppFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));
      await expect(fetch("/api/cancelled")).rejects.toThrow("aborted");
      const aborted = new FakeXHR();
      aborted.open("GET", "/api/aborted");
      aborted.send();
      aborted.complete(0, "abort");
      await advance(10_000);
      await sdk.flush();
      expect(segmentRecords(batches)).toEqual([]);
      expect(recordingSpans(batches)).toEqual([]);
      const statuses = batches
        .flatMap((batch) => batch.spans)
        .map((span) => attrs(span)["http.response.status_code"]);
      expect(statuses).toContain("404");

      const triggerAt = clock.now;
      setAppFetch(() => new Response(null, { status: 503 }));
      await fetch("/api/broken");
      await advance(4_000);
      setAppFetch(() => new Response(null, { status: 400 }));
      await fetch("/api/invalid");
      await advance(6_000);
      await sdk.flush();
      const span = recordingSpans(batches)[0];
      expect(attrs(span!)["everr.recording.trigger"]).toBe("network");
      expect(ms(span!.startTimeUnixNano)).toBe(triggerAt - 60_000);
      expect(ms(span!.endTimeUnixNano)).toBe(triggerAt + 10_000);

      setAppFetch(() => Promise.reject(new TypeError("Failed to fetch")));
      await expect(fetch("/api/down")).rejects.toThrow("Failed to fetch");
      const timedOut = new FakeXHR();
      timedOut.open("GET", "/api/slow");
      timedOut.send();
      timedOut.complete(0, "timeout");
      const failed = new FakeXHR();
      failed.open("POST", "/api/drop");
      failed.send();
      failed.complete(0, "error");
      expect(clipIdsOf(batches)).toHaveLength(2);
      await advance(10_000);
      await sdk.flush();
      expect(recordingSpans(batches)).toHaveLength(2);
      expect(attrs(recordingSpans(batches)[1]!)["everr.recording.trigger"]).toBe("network");
    } finally {
      vi.stubGlobal("XMLHttpRequest", nativeXHR);
    }
  });
});

describe("exit flush", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  });

  function hidePage(): void {
    dispatchEvent(new Event("pagehide"));
  }

  function recordsIn(batches: OtlpBatch[], marker: string) {
    return segmentRecords(batches).filter((record) => bodyText(record).includes(marker));
  }

  it("closes an open Clip at page hide, drops the unsent tail, and sends the recording span in the exit flush", async () => {
    const [sdk, batches] = startClient({ instrumentations: [recording({ maskAllText: false })] });
    track(sdk);
    await ready();
    await mutate("BEFORE");
    const start = clock.now;
    const clip = recorder.startClip({ last: 1_000, next: 60_000 });
    expect(clip.isRecording()).toBe(true);
    expect(recordingSpans(batches)).toHaveLength(0);

    // First 5s tail slice is sent before pagehide.
    await advance(1_000);
    await mutate("SENT-TAIL-SLICE");
    await advance(4_000);
    expect(recordsIn(batches, "SENT-TAIL-SLICE")).toHaveLength(1);

    // Unsent tail after the 5s slice is dropped on pagehide.
    await advance(1_000);
    await mutate("DROPPED-TAIL-AT-HIDE");
    const hiddenAt = clock.now;
    hidePage();

    expect(clip.isRecording()).toBe(false);
    expect(recordsIn(batches, "DROPPED-TAIL-AT-HIDE")).toEqual([]);

    const spanBatch = batches.find((batch) =>
      batch.spans.some((span) => span.name === "recording"),
    );
    expect(spanBatch?.keepalive).toBe(true);
    const span = recordingSpans(batches)[0]!;
    expect(ms(span.startTimeUnixNano)).toBe(start - 1_000);
    expect(ms(span.endTimeUnixNano)).toBe(hiddenAt);
    expect(attrs(span)["everr.recording.trigger"]).toBe("manual");

    hidePage();
    expect(recordingSpans(batches)).toHaveLength(1);
  });
});
