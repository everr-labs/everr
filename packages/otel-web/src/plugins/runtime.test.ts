import { afterEach, describe, expect, it, vi } from "vitest";
import { setRouteResolver } from "../route.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  type OtlpSpan,
  startClient,
  UNIQUE_ID,
} from "../test-kit.js";
import type { EverrClient, InitOptions } from "../types.js";
import { pageviews } from "./pageviews/index.js";
import type { Plugin, PluginContext } from "./runtime.js";

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<InitOptions>): void {
  [client, batches] = startClient(options);
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

async function spans(): Promise<OtlpSpan[]> {
  await client?.flush();
  return batches.flatMap((b) => b.spans);
}

afterEach(async () => {
  setRouteResolver(null);
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("plugin runtime", () => {
  it("runs setups during init, in array order, before the first capture", async () => {
    const order: string[] = [];
    const plugin =
      (name: string): Plugin =>
      (ctx) => {
        order.push(name);
        ctx.emit(`everr.test.${name}`);
      };
    start({ plugins: [plugin("a"), plugin("b"), pageviews()] });
    expect(order).toEqual(["a", "b"]);

    // Array order is capture order: both toy events precede the initial
    // page_view emitted by the pageviews() plugin composed after them.
    const names = (await records()).map((r) => r.eventName);
    expect(names).toEqual([
      "everr.test.a",
      "everr.test.b",
      "everr.browser.page_view",
    ]);
  });

  it("gives ctx.emit the ambient pipeline treatment", async () => {
    start({
      plugins: [
        (ctx) => {
          ctx.emit("everr.test.toy_event", { "everr.test.count": 3 });
        },
      ],
    });
    const [record] = await records();
    expect(record.eventName).toBe("everr.test.toy_event");
    const a = attrs(record);
    expect(a["everr.test.count"]).toBe("3");
    // The standard envelope is stamped like any built-in signal's record.
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    expect(a["everr.page_view.id"]).toMatch(UNIQUE_ID);
    expect(a["url.path"]).toBe("/");
    expect(a["everr.visitor.id"]).toMatch(UNIQUE_ID);
  });

  it("per-record attributes win over the envelope", async () => {
    start({
      plugins: [
        (ctx) => {
          ctx.emit("everr.test.shadow", { "url.path": "/overridden" });
        },
      ],
    });
    const a = attrs((await records())[0]);
    expect(a["url.path"]).toBe("/overridden");
  });

  it("exposes exactly the seven context members", () => {
    let ctx: PluginContext | undefined;
    start({
      plugins: [
        (c) => {
          ctx = c;
        },
      ],
    });
    expect(Object.keys(ctx as object).sort()).toEqual([
      "dev",
      "emit",
      "ids",
      "onNavigation",
      "page",
      "route",
      "tracer",
    ]);
    expect(ctx?.dev).toBe(true);
  });

  it("serves ids() and route() from the live client state", async () => {
    setRouteResolver(() => "/blog/$slug");
    let ids: { visitorId: string; sessionId: string } | undefined;
    let route: string | null | undefined;
    start({
      plugins: [
        (ctx) => {
          ids = ctx.ids();
          route = ctx.route();
          ctx.emit("everr.test.reader");
        },
      ],
    });
    expect(ids?.visitorId).toMatch(UNIQUE_ID);
    expect(ids?.sessionId).toMatch(UNIQUE_ID);
    expect(route).toBe("/blog/$slug");
    const a = attrs((await records())[0]);
    expect(a["everr.visitor.id"]).toBe(ids?.visitorId);
    expect(a["session.id"]).toBe(ids?.sessionId);
  });

  it("route() is null when no resolver is registered", () => {
    let route: string | null = "unset" as string | null;
    start({
      plugins: [
        (ctx) => {
          route = ctx.route();
        },
      ],
    });
    expect(route).toBeNull();
  });

  it("ships tracer spans through the traces pipeline with the envelope", async () => {
    start({
      plugins: [
        (ctx) => {
          const span = ctx.tracer.startSpan("plugin work", {
            attributes: { "everr.test.step": "one" },
          });
          span.setAttribute("everr.test.done", true);
          span.end();
          ctx.tracer.startActiveSpan("failed work", (active) => {
            active.setStatus({ code: 2 });
            active.end();
          });
        },
      ],
    });
    const [ok, failed] = await spans();
    expect(ok.name).toBe("plugin work");
    expect(ok.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ok.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ok.status?.code).toBeUndefined();
    const a = attrs(ok);
    expect(a["everr.test.step"]).toBe("one");
    expect(a["everr.test.done"]).toBe(true);
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    expect(failed.name).toBe("failed work");
    expect(failed.status?.code).toBe(2);
  });

  it("runs teardowns on shutdown in reverse order, before the pipeline closes", async () => {
    const order: string[] = [];
    const plugin =
      (name: string): Plugin =>
      (ctx) =>
      () => {
        order.push(name);
        // A teardown emit still rides the final flush.
        ctx.emit(`everr.test.bye_${name}`);
      };
    start({ plugins: [plugin("a"), plugin("b")] });
    await client?.shutdown();
    expect(order).toEqual(["b", "a"]);
    const names = batches.flatMap((b) => b.records).map((r) => r.eventName);
    expect(names).toContain("everr.test.bye_b");
    expect(names).toContain("everr.test.bye_a");
    client = undefined;
  });

  it("re-initializing tears down and sets up again", async () => {
    const calls: string[] = [];
    const plugin: Plugin = () => {
      calls.push("setup");
      return () => {
        calls.push("teardown");
      };
    };
    start({ plugins: [plugin] });
    await client?.shutdown();
    start({ plugins: [plugin], persistence: "localStorage" });
    expect(calls).toEqual(["setup", "teardown", "setup"]);
    await client?.shutdown();
    client = undefined;
    localStorage.clear();
    expect(calls).toEqual(["setup", "teardown", "setup", "teardown"]);
  });
});
