import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Sdk from "./index.js";
import { hashUnit } from "./instrumentations/sampled.js";
import { stubTransportFetch } from "./test-fetch.js";
import {
  CUSTOM,
  FULL_SNAPSHOT,
  INCREMENTAL,
  META,
  mutations,
  reassemble,
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
const bytes = (text: string) => new TextEncoder().encode(text).length;
const piece = (event: number, index: number, count: number) => ({
  "everr.recording.event.index": String(event),
  "everr.recording.event.piece": String(index),
  "everr.recording.event.pieces": String(count),
});
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
    t.rec.recorder.pause();
    t.rec.recorder.resume();
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

  it("takes a full snapshot at the first change 30 seconds after the last one", async () => {
    const t = await start();
    const opened = Date.now();
    vi.advanceTimersByTime(45_000);
    box().setAttribute("data-step", "1");
    await mutations();
    t.rec.recorder.emitClip({ last: 0 });
    const events = t.segments()[0].events;
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[1].timestamp).toBe(opened + 45_000);
  });

  it("keeps the only snapshot of an idle page past 5 minutes", async () => {
    const t = await start();
    const opened = Date.now();
    vi.advanceTimersByTime(10 * 60_000);
    t.rec.recorder.emitClip({ last: 0 });
    const events = t.segments()[0].events;
    expect(types(events)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[0].timestamp).toBe(opened);
  });

  it("starts at the last snapshot at or before the requested start", async () => {
    const t = await start();
    vi.advanceTimersByTime(35_000);
    box().setAttribute("data-step", "1");
    await mutations();
    const snapshotAt = Date.now();
    vi.advanceTimersByTime(5_000);
    const clip = t.rec.recorder.startClip({ last: 5_000 });
    clip.end();
    const events = await t.clipEvents(clip.id);
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(events[1].timestamp).toBe(snapshotAt);
    expect(clip.startTime).toBe(snapshotAt);
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
    expect(clip.startTime).toBe(opened);
    expect((await t.clipEvents(clip.id))[0].timestamp).toBe(opened);
    const [span] = await t.spans();
    expect(span.start).toBe(clip.startTime);
    expect(span.attrs["everr.recording.clip.truncated"]).toBe(true);
  });

  it("caps the buffer at 10 MB by whole generations, oldest first", async () => {
    const t = await start({ unmask: ["#box"] });
    const opened = Date.now();
    // Each change is 3 MB, and the snapshot after it holds the same 3 MB.
    for (const char of "abcd") {
      vi.advanceTimersByTime(31_000);
      box().textContent = char.repeat(3_000_000);
      await mutations();
    }
    t.rec.recorder.emitClip();
    const events = reassemble(t.segments());
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    // The last two generations, 9 MB, are what fits.
    expect(events[0].timestamp).toBe(opened + 93_000);
    expect(t.segments().reduce((sum, s) => sum + bytes(s.body), 0)).toBeLessThan(10_000_000);
  });

  it("sends each event once, and a later Clip reads the Segments already sent", async () => {
    const t = await start();
    const a = t.rec.recorder.startClip({ last: 60_000 });
    a.end();
    const count = t.segments().length;
    const b = t.rec.recorder.startClip({ last: 60_000 });
    b.end();
    expect(t.segments()).toHaveLength(count);
    expect(types(await t.clipEvents(b.id))).toEqual(types(await t.clipEvents(a.id)));
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
    const events = await t.clipEvents(clip.id);
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
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(31_000);
      box().setAttribute("data-step", String(i));
      await mutations();
    }
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
    const spans = await t.spans();
    expect(spans).toHaveLength(2);
    expect(spans[1].start).toBe(spans[0].start);
    expect(spans[1].end).toBe(spans[0].end);
    expect(spans.map((s) => s.attrs["everr.recording.trigger"])).toEqual(["manual", "manual"]);
  });

  it("sends the buffered part before startClip returns, and the new events every 5 seconds", async () => {
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

  it("closes a Clip at 60 seconds, and next: 0 at once", async () => {
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

  it("splits Segments at about 950 KB and sends a larger event in pieces", async () => {
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
    expect(segments.every((s) => bytes(s.body) <= 950_000)).toBe(true);
    const parts = segments.filter((s) => s.attrs["everr.recording.event.pieces"] !== undefined);
    expect(parts.map((s) => s.attrs)).toEqual([
      expect.objectContaining(piece(segments.length - 2, 0, 2)),
      expect.objectContaining(piece(segments.length - 2, 1, 2)),
    ]);
    expect(segments.at(-1)?.time).toBe(Date.now());
    const events = reassemble(segments);
    expect(JSON.stringify(events.at(-1))).toContain("z".repeat(1_200_000));
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

  it("closes a Clip on page hide and drops its unsent events", async () => {
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

  it("keeps a Clip open on a hidden tab, and sends what it has so far", async () => {
    const t = await start({ maskAllText: false });
    const clip = t.rec.recorder.startClip({ last: 60_000, next: 30_000 });
    box().textContent = "before the tab switch";
    await mutations();
    const setVisibility = (value: string) =>
      Object.defineProperty(document, "visibilityState", { value, configurable: true });
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    setVisibility("visible");
    expect(clip.isRecording()).toBe(true);
    expect(t.segments()).toHaveLength(2);
    expect(JSON.stringify(t.segments()[1].events)).toContain("before the tab switch");
    box().textContent = "after the tab is back";
    await mutations();
    clip.end();
    expect(JSON.stringify(t.segments().at(-1)?.events)).toContain("after the tab is back");
    expect(await t.spans()).toHaveLength(1);
  });

  it("shows beforeSend the event name as the Segment body, and sends the real body", async () => {
    const seen: string[] = [];
    const t = await start(
      {},
      {
        sdkOptions: {
          beforeSend: (item) => {
            if (item.kind !== "log") return item;
            seen.push(String(item.body));
            return { ...item, body: "rewritten" };
          },
        },
      },
    );
    t.rec.recorder.emitClip();
    expect(seen).toEqual(["everr.browser.recording.segment"]);
    expect(types(t.segments()[0].events)).toEqual([META, FULL_SNAPSHOT]);
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

describe("delivery over fetch", () => {
  type Request = { encoding?: string; text: string };
  /** A collector at a fetch endpoint. `answer` gives the response to each Segment request. */
  const collector = (answer: (encoding: string | undefined, n: number) => Response) => {
    const segments: Request[] = [];
    stubTransportFetch(
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const encoding = ((init?.headers ?? {}) as Record<string, string>)["Content-Encoding"];
        const text =
          typeof init?.body === "string"
            ? init.body
            : await new Response(
                new Response(init!.body).body!.pipeThrough(new DecompressionStream("gzip")),
              ).text();
        if (!text.includes("everr.browser.recording.segment")) return new Response(null);
        segments.push({ encoding, text });
        return answer(encoding, segments.length);
      }),
    );
    return segments;
  };
  const viaFetch = { sdkOptions: { send: undefined, endpoint: "https://collector.test" } };
  // A real macrotask: gzip runs on real ticks, which the fake clock does not drive.
  const tick = () =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve(undefined);
      };
      channel.port2.postMessage(0);
    });
  /** Moves the fake clock `ms` ahead in 100 ms steps, letting the real work of each step finish. */
  const settle = async (ms = 10_000) => {
    for (let t = 0; t < ms; t += 100) {
      for (let i = 0; i < 5; i++) await tick();
      await vi.advanceTimersByTimeAsync(100);
    }
  };

  it("sends Segments gzipped", async () => {
    const segments = collector(() => new Response(null));
    const t = await start({}, viaFetch);
    t.rec.recorder.emitClip();
    await settle();
    expect(segments.map((r) => r.encoding)).toEqual(["gzip"]);
    expect(segments[0].text).toContain('\\"type\\":4');
  });

  it("tries a 5xx or a 429 again twice, 2 and 4 seconds later, and then gives up", async () => {
    const times: number[] = [];
    const segments = collector((_, n) => {
      times.push(Date.now());
      return new Response(null, { status: n === 1 ? 503 : 429 });
    });
    const t = await start({}, viaFetch);
    t.rec.recorder.emitClip();
    for (let i = 0; i < 400 && segments.length < 3; i++) await settle(100);
    await settle();
    expect(segments.map((r) => r.encoding)).toEqual(["gzip", "gzip", "gzip"]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(2_000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(4_000);
  });

  it("does not try a 4xx again", async () => {
    const segments = collector(() => new Response(null, { status: 400 }));
    const t = await start({}, viaFetch);
    t.rec.recorder.emitClip();
    await settle();
    expect(segments).toHaveLength(1);
  });

  it("sends plain from then on when a gzipped request fails and the plain retry goes through", async () => {
    // A collector whose CORS refuses Content-Encoding fails each gzipped request.
    const segments = collector((encoding) => {
      if (encoding) throw new TypeError("Failed to fetch");
      return new Response(null);
    });
    const t = await start({}, viaFetch);
    t.rec.recorder.emitClip();
    await settle();
    box().textContent = "next";
    await mutations();
    t.rec.recorder.emitClip();
    await settle();
    // The gzipped try failed, its plain retry went through, and the next
    // Segment goes plain at once.
    expect(segments.map((r) => r.encoding)).toEqual(["gzip", undefined, undefined]);
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
    const count = t.segments().length;
    const after = t.rec.recorder.startClip();
    expect(after.isRecording()).toBe(true);
    after.end();
    const last = t.segments().slice(count);
    expect(last[0].attrs["everr.recording.stream.id"]).toBe(
      first.attrs["everr.recording.stream.id"],
    );
    expect(last[0].attrs["session.id"]).toBe(first.attrs["session.id"]);
  });
});

describe("pause and resume", () => {
  it("marks pause and resume, and buffers nothing between them", async () => {
    const t = await start();
    t.rec.recorder.pause();
    t.rec.recorder.pause();
    box().textContent = "while paused";
    await mutations();
    t.rec.recorder.resume();
    t.rec.recorder.resume();
    t.rec.recorder.emitClip();
    const all = t.segments().flatMap((s) => s.events);
    expect(tags(all)).toEqual(["everr.recording.pause", "everr.recording.resume"]);
    expect(JSON.stringify(all)).not.toContain('"texts":[{');
  });
});

describe("large events", () => {
  // The text of the box in the reassembled events, as its JSON string.
  const holds = (events: RrwebEvent[], text: string) =>
    JSON.stringify(events).includes(JSON.stringify(text).slice(1, -1));

  it("keeps recording past an event over 10 MB, and sends it in pieces that join back", async () => {
    const t = await start({ unmask: ["#box"] });
    // A Clip from the call, since the 10 MB buffer keeps only the newest event.
    const clip = t.rec.recorder.startClip();
    // 3.4 million characters, but 10.2 MB in UTF-8.
    const large = "€".repeat(3_400_000);
    box().textContent = large;
    await mutations();
    box().textContent = "small again";
    await mutations();
    clip.end();
    const segments = t.segments();
    const parts = segments.filter((s) => s.attrs["everr.recording.event.pieces"] !== undefined);
    expect(parts.length).toBeGreaterThanOrEqual(11);
    expect(parts.every((s) => bytes(s.body) <= 950_000)).toBe(true);
    const first = Number(parts[0].attrs["everr.recording.segment.index"]);
    expect(parts.map((s) => s.attrs)).toEqual(
      parts.map((_, i) => expect.objectContaining(piece(first, i, parts.length))),
    );
    const events = await t.clipEvents(clip.id);
    expect(tags(events)).toEqual([]);
    expect(holds(events, large)).toBe(true);
    expect(holds(events, "small again")).toBe(true);
  });

  it("sends a first snapshot over 10 MB in pieces, and plays from it", async () => {
    const large = "€".repeat(3_400_000);
    document.body.innerHTML = `<div id="box" class="keep">${large}</div>`;
    const t = await start({ unmask: [".keep"] });
    t.rec.recorder.emitClip();
    const events = reassemble(t.segments());
    expect(types(events).slice(0, 2)).toEqual([META, FULL_SNAPSHOT]);
    expect(holds(events.slice(1, 2), large)).toBe(true);
  });

  it("splits between code points, so emoji and quotes join back unchanged", async () => {
    const t = await start({ unmask: ["#box"] });
    // 14 bytes per repeat in the JSON, so the 950 KB boundaries fall inside 2-, 3-, and 4-byte characters.
    const text = 'a"😀é€\\'.repeat(400_000) + "😀";
    box().textContent = text;
    await mutations();
    t.rec.recorder.emitClip({ last: 0 });
    const parts = t.segments().filter((s) => s.attrs["everr.recording.event.pieces"] !== undefined);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(new TextDecoder().decode(new TextEncoder().encode(part.body))).toBe(part.body);
      expect(part.body).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
    }
    expect(holds(reassemble(t.segments()), text)).toBe(true);
  });

  it("keeps each request under the 20 MiB receiver limit, however escaped", async () => {
    const t = await start({ unmask: ["#box"] });
    // Quotes double on each escape: once in the event JSON, once in the OTLP string.
    const clip = t.rec.recorder.startClip();
    const text = '"'.repeat(9_000_000);
    box().textContent = text;
    await mutations();
    clip.end();
    const logs = t.sent.filter((s) => s.signal === "logs");
    expect(logs.length).toBeGreaterThan(10);
    expect(Math.max(...logs.map((s) => bytes(s.body)))).toBeLessThan(2 * 1024 * 1024);
    expect(holds(await t.clipEvents(clip.id), text)).toBe(true);
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
    const count = (await t.clipEvents(before.id)).length;
    for (let i = 0; i < 60; i++) {
      document.getElementById("a")!.setAttribute("x", String(i));
      document.getElementById("b")!.setAttribute("x", String(i));
      await mutations();
    }
    const clip = t.rec.recorder.startClip({ last: 300_000 });
    clip.end();
    const events = await t.clipEvents(clip.id);
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
    const last = (await t.clipEvents(clip.id)).at(-1)!;
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
    vi.advanceTimersByTime(35_000);
    box().setAttribute("data-step", "1");
    await mutations();
    const snapshotAt = Date.now();
    vi.advanceTimersByTime(65_000);
    const erroredAt = Date.now();
    t.sdk.captureError(new Error("boom"));
    vi.advanceTimersByTime(10_000);
    const [span] = await t.spans();
    expect(span.attrs["everr.recording.trigger"]).toBe("error");
    // The newest snapshot at or before 60 seconds back.
    expect(span.start).toBe(snapshotAt);
    expect(span.end).toBe(erroredAt + 10_000);
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
    vi.advanceTimersByTime(10_000);
    expect(
      (await t.spans()).filter((s) => s.attrs["everr.recording.trigger"] === "error"),
    ).toHaveLength(1);
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
