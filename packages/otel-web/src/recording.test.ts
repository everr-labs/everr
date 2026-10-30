import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Sdk from "./index.js";
import { hashUnit } from "./instrumentations/sampled.js";
import {
  CUSTOM,
  FULL_SNAPSHOT,
  INCREMENTAL,
  META,
  mutations,
  type RrwebEvent,
  type Started,
  start as startRecording,
} from "./recording/test-kit.js";

const running: Started[] = [];
const start = async (...args: Parameters<typeof startRecording>) => {
  const t = await startRecording(...args);
  running.push(t);
  return t;
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  document.body.innerHTML = `<main><p id="p">hello</p><div id="box"></div></main>`;
});

afterEach(async () => {
  for (const t of running.splice(0)) await t.client.shutdown();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("./recording/recorder.js");
  localStorage.clear();
  document.body.innerHTML = "";
});

const box = () => document.getElementById("box")!;
const types = (events: { type: number }[]) => events.map((e) => e.type);
const tags = (events: { type: number; data: { tag?: string } }[]) =>
  events.filter((e) => e.type === CUSTOM).map((e) => e.data.tag);
/** A session id whose recording hash is below or at least `rate`. */
const sessionWhere = (keep: boolean, rate: number) => {
  for (let i = 0; ; i++) {
    const id = `1700000000000-${1_000_000_000_000 + i}`;
    if (hashUnit(`${id}:recording`) < rate === keep) return id;
  }
};
const seedSession = (id: string) =>
  localStorage.setItem("everr.session", JSON.stringify({ id, t: Date.now() }));

describe("loading and sampling", () => {
  it("sends nothing before a Clip", async () => {
    const t = await start();
    box().textContent = "changed";
    await mutations();
    vi.advanceTimersByTime(65_000);
    expect(t.sent).toEqual([]);
  });

  it("does not load the chunk in an unsampled Session", async () => {
    const startStream = vi.fn();
    vi.doMock("./recording/recorder.js", () => ({ startStream }));
    const t = await start({}, { rate: 0 });
    expect(startStream).not.toHaveBeenCalled();
    const clip = t.rec.recorder.startClip();
    expect(clip.id).toBe("");
    expect(clip.isRecording()).toBe(false);
    t.rec.recorder.emitClip();
    expect(t.sent).toEqual([]);
  });

  it("decides by the hash of the Session id, the same in each reload and tab", async () => {
    const kept = sessionWhere(true, 0.5);
    const dropped = sessionWhere(false, 0.5);
    for (const [id, recorded] of [
      [kept, true],
      [dropped, false],
      [kept, true],
    ] as const) {
      seedSession(id);
      const t = await start({}, { rate: 0.5, sdkOptions: { persistence: "localStorage" } });
      expect(t.rec.recorder.startClip().isRecording()).toBe(recorded);
      await t.client.shutdown();
    }
  });

  it("does not surface a failed chunk import as an app error", async () => {
    vi.doMock("./recording/recorder.js", () => {
      throw new Error("chunk failed");
    });
    // Vitest fails the run on an unhandled rejection.
    const t = await start();
    expect(t.rec.recorder.startClip().id).toBe("");
  });

  it("returns an inert Clip before the chunk loads", async () => {
    const t = await start({}, { settle: false });
    const clip = t.rec.recorder.startClip({ last: 1_000 });
    expect(clip).toMatchObject({ id: "", startTime: Date.now() - 1_000 });
    clip.end();
    await vi.dynamicImportSettled();
    expect(t.segments()).toEqual([]);
  });

  it("runs one recorder per page, and records again after shutdown", async () => {
    const first = await start();
    const other = new first.sdk.WebSDK({
      serviceName: "second",
      persistence: "memory",
      send: (signal, body) => void first.sent.push({ signal, body }),
      instrumentations: [first.rec.recording()],
    });
    await vi.dynamicImportSettled();
    first.rec.recorder.emitClip();
    expect(new Set(first.segments().map((s) => s.attrs["everr.recording.stream.id"])).size).toBe(1);
    await other.shutdown();
    await first.client.shutdown();
    expect(first.rec.recorder.startClip().id).toBe("");

    const later = new first.sdk.WebSDK({
      serviceName: "later",
      persistence: "memory",
      send: (signal, body) => void first.sent.push({ signal, body }),
      instrumentations: [first.rec.recording()],
    });
    await vi.dynamicImportSettled();
    expect(first.rec.recorder.startClip().isRecording()).toBe(true);
    await later.shutdown();
  });

  it("does not patch fetch", async () => {
    const fetch = globalThis.fetch;
    await start();
    expect(globalThis.fetch).toBe(fetch);
  });
});

describe("the buffer", () => {
  it("keeps the last 5 minutes, and emitClip() sends all of it from a full snapshot with its Meta", async () => {
    const t = await start();
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(30_000);
      box().setAttribute("data-step", String(i));
      await mutations();
    }
    const now = Date.now();
    t.rec.recorder.emitClip();
    const events = t.segments().flatMap((s) => s.events);
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[0].timestamp).toBeGreaterThanOrEqual(now - 300_000);
    expect(events[0].timestamp).toBeLessThanOrEqual(now - 270_000);
    const [span] = await t.spans();
    expect(span.start).toBe(events[0].timestamp);
    expect(span.attrs["everr.recording.clip.truncated"]).toBeUndefined();
  });

  it("takes a full snapshot every 30 seconds", async () => {
    const t = await start();
    const opened = Date.now();
    vi.advanceTimersByTime(30_000);
    t.rec.recorder.emitClip({ last: 0 });
    const events = t.segments()[0].events;
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[1].timestamp).toBe(opened + 30_000);
  });

  it("starts at the last snapshot at or before the requested start", async () => {
    const t = await start();
    vi.advanceTimersByTime(40_000);
    const clip = t.rec.recorder.startClip({ last: 5_000 });
    clip.end();
    const events = t.clipEvents(clip.id);
    expect(events[1].type).toBe(FULL_SNAPSHOT);
    expect(events[1].timestamp).toBe(clip.startTime - 5_000);
    const [span] = await t.spans();
    expect(span.start).toBe(clip.startTime);
    expect(span.attrs["everr.recording.clip.truncated"]).toBeUndefined();
  });

  it("truncates a Clip that asks for more than the buffer holds", async () => {
    const t = await start();
    const opened = Date.now();
    vi.advanceTimersByTime(10_000);
    const clip = t.rec.recorder.startClip({ last: 600_000 });
    clip.end();
    expect(clip.startTime).toBe(Date.now() - 600_000);
    expect(t.clipEvents(clip.id)[0].timestamp).toBe(opened);
    const [span] = await t.spans();
    expect(span.start).toBe(clip.startTime);
    expect(span.attrs["everr.recording.clip.truncated"]).toBe(true);
  });

  it("caps the buffer at 10 MB, oldest first", async () => {
    const t = await start({ unmask: ["#box"] });
    const chunk = "x".repeat(3_000_000);
    for (let i = 0; i < 3; i++) {
      box().textContent = chunk;
      await mutations();
    }
    // About 9 MB: the first snapshot is still in the buffer.
    expect(t.rec.recorder.startClip({ last: 300_000 }).isRecording()).toBe(true);
    box().textContent = chunk;
    await mutations();
    // Past the cap the oldest events, the snapshot first, leave the buffer.
    expect(t.rec.recorder.startClip({ last: 300_000 }).id).toBe("");
  });

  it("keeps the buffer after a Clip", async () => {
    const t = await start();
    const a = t.rec.recorder.startClip({ last: 60_000 });
    a.end();
    const b = t.rec.recorder.startClip({ last: 60_000 });
    b.end();
    expect(types(t.clipEvents(b.id))).toEqual(types(t.clipEvents(a.id)));
    expect(a.id).not.toBe(b.id);
  });
});

describe("Clips", () => {
  it("records from the call to end() when startClip has no last", async () => {
    const t = await start({ unmask: ["#box"] });
    vi.advanceTimersByTime(40_000);
    box().textContent = "before the call";
    await mutations();
    vi.advanceTimersByTime(1_000);
    const calledAt = Date.now();
    const clip = t.rec.recorder.startClip();
    expect(clip.startTime).toBe(calledAt);
    expect(t.segments()).toEqual([]);
    box().textContent = "during the clip";
    await mutations();
    vi.advanceTimersByTime(2_000);
    clip.end();
    box().textContent = "after end";
    await mutations();
    vi.advanceTimersByTime(10_000);
    const events = t.clipEvents(clip.id);
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[0].timestamp).toBe(calledAt);
    expect(events.every((e) => e.timestamp >= calledAt)).toBe(true);
    const json = JSON.stringify(events);
    // The new snapshot holds the page as it is at the call, not the mutation before it.
    expect(json.match(/before the call/g)).toHaveLength(1);
    expect(events.slice(2).some((e) => JSON.stringify(e).includes("before the call"))).toBe(false);
    expect(json).toContain("during the clip");
    expect(json).not.toContain("after end");
    const [span] = await t.spans();
    expect(span.start).toBe(calledAt);
    expect(span.end).toBe(calledAt + 2_000);
    expect(span.attrs["everr.recording.clip.truncated"]).toBeUndefined();
  });

  it("emitClip() with no last sends the whole buffer", async () => {
    const t = await start();
    const opened = Date.now();
    vi.advanceTimersByTime(100_000);
    t.rec.recorder.emitClip();
    const events = t.segments().flatMap((s) => s.events);
    expect(events[0].timestamp).toBe(opened);
    expect(types(events).filter((type) => type === FULL_SNAPSHOT)).toHaveLength(4);
  });

  it("emitClip sends the same Clip as startClip().end() with the same last", async () => {
    const t = await start();
    t.rec.recorder.emitClip({ last: 60_000 });
    const viaEnd = t.rec.recorder.startClip({ last: 60_000 });
    viaEnd.end();
    const [first, second] = t.segments();
    expect(types(first.events)).toEqual(types(second.events));
    const spans = await t.spans();
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.attrs["everr.recording.trigger"])).toEqual(["manual", "manual"]);
  });

  it("sends the buffered part before startClip returns, and the tail every 5 seconds", async () => {
    const t = await start();
    const clip = t.rec.recorder.startClip({ last: 60_000, next: 12_000 });
    expect(t.segments()).toHaveLength(1);
    box().textContent = "one";
    await mutations();
    vi.advanceTimersByTime(5_000);
    expect(t.segments()).toHaveLength(2);
    box().textContent = "two";
    await mutations();
    expect(clip.isRecording()).toBe(true);
    vi.advanceTimersByTime(7_000);
    expect(clip.isRecording()).toBe(false);
    expect(t.segments().map((s) => Number(s.attrs["everr.recording.segment.index"]))).toEqual([
      0, 1, 2,
    ]);
    const [span] = await t.spans();
    expect(span.end).toBe(Date.now());
  });

  it("closes a tail at 60 seconds, and next: 0 at once", async () => {
    const t = await start();
    const open = t.rec.recorder.startClip({ next: 120_000 });
    const closed = t.rec.recorder.startClip({ next: 0 });
    expect(closed.isRecording()).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(open.isRecording()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(open.isRecording()).toBe(false);
  });

  it("makes end() idempotent", async () => {
    const t = await start();
    const clip = t.rec.recorder.startClip();
    clip.end();
    const count = t.sent.length;
    clip.end();
    expect(t.sent.length).toBe(count);
    expect(await t.spans()).toHaveLength(1);
  });

  it("emits one root recording Span per Clip, also inside an active span", async () => {
    const t = await start();
    let clipId = "";
    t.sdk.tracer.startActiveSpan("parent", (parent) => {
      clipId = t.rec.recorder.startClip().id;
      t.rec.recorder.startClip().end();
      parent.end();
    });
    vi.advanceTimersByTime(60_000);
    const spans = await t.spans();
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.parentSpanId === undefined)).toBe(true);
    expect(spans.map((s) => s.attrs["everr.recording.clip.id"])).toContain(clipId);
    expect(t.segments().every((s) => s.traceId === undefined)).toBe(true);
  });

  it("splits Segments at about 950 KB and sends a larger event alone", async () => {
    const t = await start({ unmask: ["#box"] });
    for (let i = 0; i < 4; i++) {
      box().textContent = "y".repeat(400_000);
      await mutations();
    }
    box().textContent = "z".repeat(1_200_000);
    await mutations();
    t.rec.recorder.emitClip();
    const segments = t.segments();
    expect(segments.map((s) => Number(s.attrs["everr.recording.segment.index"]))).toEqual(
      segments.map((_, i) => i),
    );
    const sizes = segments.map((s) => new TextEncoder().encode(JSON.stringify(s.events)).length);
    const large = segments.findIndex((s) => JSON.stringify(s.events).includes("zzzz"));
    expect(segments[large].events).toHaveLength(1);
    expect(sizes.filter((_, i) => i !== large).every((size) => size <= 950_000)).toBe(true);
    expect(segments.at(-1)?.time).toBe(segments.at(-1)?.events.at(-1)?.timestamp);
  });

  it("drops a Segment that beforeSend drops", async () => {
    const t = await start(
      {},
      {
        sdkOptions: { beforeSend: (item) => (item.kind === "log" ? null : item) },
      },
    );
    t.rec.recorder.emitClip();
    expect(t.segments()).toEqual([]);
  });

  it("closes a Clip on page hide and drops its unsent tail", async () => {
    const t = await start();
    const clip = t.rec.recorder.startClip({ last: 60_000, next: 30_000 });
    box().textContent = "unsent";
    await mutations();
    vi.advanceTimersByTime(1_000);
    const hiddenAt = Date.now();
    window.dispatchEvent(new Event("pagehide"));
    expect(clip.isRecording()).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(t.segments()).toHaveLength(1);
    const span = (await t.spans()).find((s) => s.attrs["everr.recording.clip.id"] === clip.id);
    expect(span?.end).toBe(hiddenAt);
  });

  it("finishes the recording Span of an open Clip on shutdown", async () => {
    const t = await start();
    const clip = t.rec.recorder.startClip({ last: 60_000, next: 30_000 });
    box().textContent = "tail";
    await mutations();
    await t.client.shutdown();
    expect(clip.isRecording()).toBe(false);
    expect(t.segments()).toHaveLength(2);
    expect(await t.spans()).toHaveLength(1);
  });
});

describe("the Stream and the Session", () => {
  it("puts the Stream id on the envelope while the Stream buffers", async () => {
    const t = await start();
    t.sdk.logger.info("while recording");
    const clip = t.rec.recorder.startClip();
    clip.end();
    const streamId = t.segments()[0].attrs["everr.recording.stream.id"];
    const [log] = await t.logs();
    expect(log.attrs["everr.recording.stream.id"]).toBe(streamId);
    const [span] = await t.spans();
    expect(span.attrs["everr.recording.stream.id"]).toBe(streamId);
  });

  it("never reads the Session, so a busy recorder does not keep it alive", async () => {
    const t = await start();
    t.sdk.logger.info("first");
    const [first] = await t.logs();
    for (let i = 0; i < 31; i++) {
      box().setAttribute("data-minute", String(i));
      await mutations();
      t.rec.recorder.emitClip({ last: 1_000 });
      vi.advanceTimersByTime(60_000);
    }
    const sessions = new Set(t.segments().map((s) => s.attrs["session.id"]));
    expect(sessions).toEqual(new Set([first.attrs["session.id"]]));
    t.sdk.logger.info("after the timeout");
    const logs = await t.logs();
    expect(logs.at(-1)?.attrs["session.id"]).not.toBe(first.attrs["session.id"]);
  });

  it("keeps one Stream for the page when the Session changes", async () => {
    const t = await start();
    const before = t.rec.recorder.startClip();
    before.end();
    const [first] = t.segments();
    vi.advanceTimersByTime(31 * 60_000);
    t.sdk.logger.info("new session");
    t.sdk.clearIdentity();
    t.sdk.logger.info("cleared");
    const after = t.rec.recorder.startClip();
    expect(after.isRecording()).toBe(true);
    after.end();
    const last = t.segments().filter((s) => s.attrs["everr.recording.clip.id"] === after.id);
    expect(last[0].attrs["everr.recording.stream.id"]).toBe(
      first.attrs["everr.recording.stream.id"],
    );
    expect(last[0].attrs["session.id"]).toBe(first.attrs["session.id"]);
  });
});

describe("oversized events", () => {
  it("stops at an event over 10 MB of UTF-8 for the rest of the page, and keeps the buffer", async () => {
    const t = await start({ unmask: ["#box"] });
    // 3.4 million characters, but 10.2 MB in UTF-8.
    box().textContent = "€".repeat(3_400_000);
    await mutations();
    const clip = t.rec.recorder.startClip({ last: 300_000 });
    clip.end();
    const events = t.clipEvents(clip.id);
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(tags(events)).toEqual(["everr.recording.oversized"]);

    box().textContent = "small again";
    await mutations();
    expect(
      JSON.stringify(t.clipEvents(t.rec.recorder.startClip({ last: 300_000 }).id)),
    ).not.toContain("small again");

    vi.advanceTimersByTime(60_000);
    t.rec.recorder.emitClip();
    const later = t.segments().at(-1)!.events;
    expect(tags(later)).toEqual(["everr.recording.oversized"]);
    expect(types(later).filter((type) => type === FULL_SNAPSHOT)).toHaveLength(1);
  });

  it("returns an inert Clip from startClip() without last after the stop", async () => {
    const t = await start({ unmask: ["#box"] });
    box().textContent = "€".repeat(3_400_000);
    await mutations();
    const sent = t.sent.length;
    const clip = t.rec.recorder.startClip();
    expect(clip.id).toBe("");
    expect(clip.isRecording()).toBe(false);
    clip.end();
    vi.advanceTimersByTime(60_000);
    expect(t.sent.length).toBe(sent);
    expect(await t.spans()).toEqual([]);
  });

  it("stops when the first snapshot itself is oversized, and has no Clip to send", async () => {
    document.body.innerHTML = `<div id="box" class="keep">${"€".repeat(3_400_000)}</div>`;
    const t = await start({ unmask: [".keep"] });
    expect(t.rec.recorder.startClip({ last: 300_000 }).id).toBe("");
    expect(t.sent).toEqual([]);
  });

  it("keeps the request body of a 10 MB event under the 20 MiB receiver limit", async () => {
    const t = await start({ unmask: ["#box"] });
    // Quotes double on each escape: once in the event JSON, once in the OTLP
    // string. No character grows more, so a 10 MB event stays under 20 MiB.
    box().textContent = '"'.repeat(4_999_000);
    await mutations();
    t.rec.recorder.emitClip({ last: 0 });
    const large = t.sent.filter((s) => s.body.includes('\\\\\\"\\\\\\"'));
    expect(large).toHaveLength(1);
    const eventBytes = t.segments().find((s) => JSON.stringify(s.events).includes('\\"\\"'))!;
    expect(new TextEncoder().encode(JSON.stringify(eventBytes.events)).length).toBeGreaterThan(
      9_990_000,
    );
    expect(new TextEncoder().encode(large[0].body).length).toBeLessThan(20 * 1024 * 1024);
  });
});

describe("the mutation throttle", () => {
  const attributeChanges = (events: RrwebEvent[]) =>
    events
      .filter((e) => e.type === INCREMENTAL && e.data.source === 0)
      .flatMap((e) => e.data.attributes as unknown[]).length;

  it("takes one token per attribute mutation, from 100, refilling 10 per second", async () => {
    const t = await start();
    for (let i = 0; i < 150; i++) {
      box().setAttribute("data-i", String(i));
      await mutations();
    }
    vi.advanceTimersByTime(1_000);
    for (let i = 0; i < 20; i++) {
      box().setAttribute("data-i", `again ${i}`);
      await mutations();
    }
    t.rec.recorder.emitClip();
    expect(attributeChanges(t.segments()[0].events)).toBe(110);
  });

  it("charges SVG descendants to the nearest svg, and drops emptied events", async () => {
    box().innerHTML = `<svg id="svg"><g><rect id="a"></rect><rect id="b"></rect></g></svg>`;
    const t = await start({ blockAllMedia: false });
    const before = t.rec.recorder.startClip({ last: 300_000 });
    before.end();
    const count = t.clipEvents(before.id).length;
    for (let i = 0; i < 60; i++) {
      document.getElementById("a")!.setAttribute("x", String(i));
      document.getElementById("b")!.setAttribute("x", String(i));
      await mutations();
    }
    const clip = t.rec.recorder.startClip({ last: 300_000 });
    clip.end();
    const events = t.clipEvents(clip.id);
    expect(attributeChanges(events)).toBe(100);
    // 60 events with mutations, of which 10 fully emptied ones are dropped.
    expect(events.length - count).toBe(50);
  });

  it("lets adds, removes, and texts through with an empty bucket", async () => {
    const t = await start();
    for (let i = 0; i < 120; i++) {
      box().setAttribute("data-i", String(i));
      await mutations();
    }
    box().setAttribute("data-i", "last");
    box().append(document.createElement("span"));
    document.getElementById("p")!.firstChild!.textContent = "changed";
    await mutations();
    const clip = t.rec.recorder.startClip({ last: 0 });
    clip.end();
    const last = t.clipEvents(clip.id).at(-1)!;
    expect(last.data.attributes).toEqual([]);
    expect(last.data.adds).toHaveLength(1);
    expect(last.data.texts).toHaveLength(1);
  });
});

describe("automatic Clips", () => {
  const withErrors = {
    extra: (sdk: typeof Sdk) => [sdk.errors({ ignore: [/ignored/] })],
  };

  it("opens a Clip on an error, with the last 60 seconds and the next 10", async () => {
    const t = await start({}, withErrors);
    vi.advanceTimersByTime(90_000);
    t.sdk.captureError(new Error("boom"));
    vi.advanceTimersByTime(10_000);
    const [span] = await t.spans();
    expect(span.attrs["everr.recording.trigger"]).toBe("error");
    expect(span.end - span.start).toBe(70_000);
  });

  it("ignores filtered errors", async () => {
    const t = await start({}, withErrors);
    window.dispatchEvent(
      new ErrorEvent("error", { message: "ignored", error: new Error("ignored") }),
    );
    expect(t.segments()).toEqual([]);
  });

  it("ignores triggers while an automatic Clip is open, and caps the page at 5", async () => {
    const t = await start({}, withErrors);
    t.sdk.captureError(new Error("one"));
    t.sdk.captureError(new Error("two"));
    expect(new Set(t.segments().map((s) => s.attrs["everr.recording.clip.id"])).size).toBe(1);
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(11_000);
      t.sdk.captureError(new Error(`next ${i}`));
    }
    t.rec.recorder.emitClip();
    const spans = await t.spans();
    expect(spans.filter((s) => s.attrs["everr.recording.trigger"] === "error")).toHaveLength(5);
    expect(spans.filter((s) => s.attrs["everr.recording.trigger"] === "manual")).toHaveLength(1);
  });

  it("does not block manual Clips, and does not count them", async () => {
    const t = await start({}, withErrors);
    t.sdk.captureError(new Error("one"));
    const manual = t.rec.recorder.startClip();
    expect(manual.isRecording()).toBe(true);
    manual.end();
    for (let i = 0; i < 5; i++) t.rec.recorder.emitClip();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(11_000);
      t.sdk.captureError(new Error(`next ${i}`));
    }
    vi.advanceTimersByTime(10_000);
    const spans = await t.spans();
    expect(spans.filter((s) => s.attrs["everr.recording.trigger"] === "error")).toHaveLength(5);
  });

  it("drops a trigger that arrives before the Stream buffers", async () => {
    const t = await start({}, { ...withErrors, settle: false });
    t.sdk.captureError(new Error("early"));
    await vi.dynamicImportSettled();
    vi.advanceTimersByTime(20_000);
    expect(t.segments()).toEqual([]);
  });

  describe("from network()", () => {
    const withNetwork = { extra: (sdk: typeof Sdk) => [sdk.network()] };
    const respond = (result: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(result));
    const triggers = async (t: Started) =>
      (await t.spans()).map((s) => s.attrs["everr.recording.trigger"]);

    it("opens a Clip on a 5xx", async () => {
      respond(() => Promise.resolve(new Response(null, { status: 503 })));
      const t = await start({}, withNetwork);
      await fetch("/api");
      vi.advanceTimersByTime(10_000);
      expect(await triggers(t)).toEqual(["network"]);
    });

    it("opens a Clip on a request with no response", async () => {
      respond(() => Promise.reject(new TypeError("Failed to fetch")));
      const t = await start({}, withNetwork);
      await fetch("/api").catch(() => {});
      vi.advanceTimersByTime(10_000);
      expect(await triggers(t)).toEqual(["network"]);
    });

    it("ignores a 4xx and an abort", async () => {
      let status = 404;
      respond(() =>
        status
          ? Promise.resolve(new Response(null, { status }))
          : Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
      const t = await start({}, withNetwork);
      await fetch("/api");
      status = 0;
      await fetch("/api").catch(() => {});
      vi.advanceTimersByTime(10_000);
      expect(await triggers(t)).toEqual([]);
    });
  });
});
