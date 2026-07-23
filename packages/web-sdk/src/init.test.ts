import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./client.js";
import type { CaptureSignal, EverrClient } from "./types.js";

type OtlpRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  body?: unknown;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

let client: EverrClient | undefined;
let batches: Array<{
  resource: Array<{ key: string; value: Record<string, unknown> }>;
  records: OtlpRecord[];
}>;

function start(options?: { disable?: true | CaptureSignal[] }): void {
  batches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const resourceLog = payload.resourceLogs[0];
      batches.push({
        resource: resourceLog.resource.attributes,
        records: resourceLog.scopeLogs[0].logRecords,
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  client = init({
    mode: "cookieless",
    serviceName: "everr-docs-test",
    dev: true,
    disable: options?.disable,
  });
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

function attrs(record: OtlpRecord): Record<string, unknown> {
  return Object.fromEntries(
    record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

async function resourceAttrs(): Promise<Record<string, unknown>> {
  await client?.flush();
  return Object.fromEntries(
    batches[0].resource.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("init (cookieless)", () => {
  it("emits an enveloped browser.page_view for the initial load", async () => {
    start();
    const all = await records();
    expect(all).toHaveLength(1);
    const record = all[0];
    expect(record.eventName).toBe("browser.page_view");
    expect(record.severityNumber).toBe(9);
    expect(record.body).toBeUndefined();
    const a = attrs(record);
    expect(a["everr.navigation.type"]).toBe("initial");
    expect(a["session.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["everr.page_view.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["everr.event.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["url.full"]).toBe(window.location.href);
    expect(a["url.path"]).toBe("/");
    const resource = await resourceAttrs();
    expect(resource["service.name"]).toBe("everr-docs-test");
    expect(resource["everr.sdk.name"]).toBe("@everr/web-sdk");
    expect(resource["user_agent.original"]).toBeTruthy();
    // Unset optional attributes are filtered out, not shipped as empty values.
    expect(resource).not.toHaveProperty("deployment.environment.name");
  });

  it("emits history_change pageviews for SPA navigations, rotating the pageview id", async () => {
    start();
    history.pushState(null, "", "/pricing");
    const [initial, leave, spa] = await records();
    expect(spa.eventName).toBe("browser.page_view");
    const spaAttrs = attrs(spa);
    const initialAttrs = attrs(initial);
    expect(spaAttrs["everr.navigation.type"]).toBe("history_change");
    expect(spaAttrs["url.path"]).toBe("/pricing");
    expect(spaAttrs["everr.referrer.url"]).toBe(initialAttrs["url.full"]);
    expect(spaAttrs["everr.page_view.id"]).not.toBe(
      initialAttrs["everr.page_view.id"],
    );
    expect(spaAttrs["session.id"]).toBe(initialAttrs["session.id"]);

    // The outgoing page's leave sits between the two views, linked to the
    // initial pageview and carrying duration and scroll depth.
    expect(leave.eventName).toBe("browser.page_leave");
    const leaveAttrs = attrs(leave);
    expect(leaveAttrs["everr.page_view.id"]).toBe(
      initialAttrs["everr.page_view.id"],
    );
    expect(leaveAttrs["url.path"]).toBe("/");
    expect(String(leaveAttrs["everr.page_view.duration_ms"])).toMatch(/^\d+$/);
    expect(leaveAttrs["everr.scroll.depth"]).toBe("0");
  });

  it("emits the pending page_leave and exit-flushes with keepalive on pagehide", async () => {
    start();
    dispatchEvent(new Event("pagehide"));
    const all = await records();
    // The exit flush sorts the batch by priority; timestamps carry ordering.
    expect(all.map((r) => r.eventName).sort()).toEqual([
      "browser.page_leave",
      "browser.page_view",
    ]);
    // A repeated hide (tab restored, hidden again) does not duplicate the leave.
    dispatchEvent(new Event("pagehide"));
    expect(await records()).toHaveLength(2);
  });

  it("emits the leave on visibilitychange to hidden", async () => {
    start();
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    expect((await records()).map((r) => r.eventName).sort()).toEqual([
      "browser.page_leave",
      "browser.page_view",
    ]);
  });

  it("emits no leave on hide when pageviews are disabled", async () => {
    start({ disable: ["pageviews"] });
    dispatchEvent(new Event("pagehide"));
    expect(await records()).toHaveLength(0);
  });

  it("does not emit for a pushState to the same URL", async () => {
    start();
    history.pushState(null, "", window.location.href);
    expect(await records()).toHaveLength(1);
  });

  it("emits on popstate navigations", async () => {
    start();
    history.pushState(null, "", "/a");
    history.replaceState(null, "", "/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    // /a and /b changed the URL (a view and a leave each); the popstate with
    // an unchanged URL is deduped.
    expect(await records()).toHaveLength(5);
  });

  it("writes zero cookies and zero storage", async () => {
    start();
    history.pushState(null, "", "/anywhere");
    await records();
    expect(document.cookie).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("emits nothing with disable: true", async () => {
    start({ disable: true });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it('suppresses pageviews only with disable: ["pageviews"]', async () => {
    start({ disable: ["pageviews"] });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
  });

  it("keeps watching navigations when pageviews are off, so the envelope stays fresh", () => {
    const pushState = history.pushState;
    start({ disable: ["pageviews"] });
    // The navigation watcher is envelope infrastructure, not a signal: it
    // must patch history even when no pageview listener is registered.
    expect(history.pushState).not.toBe(pushState);
  });

  it("stops emitting and unpatches history after shutdown", async () => {
    start();
    expect(await records()).toHaveLength(1);
    const pushState = history.pushState;
    await client?.shutdown();
    expect(history.pushState).not.toBe(pushState);
    history.pushState(null, "", "/after-shutdown");
    expect(await records()).toHaveLength(1);
    client = undefined;
  });

  it("rejects consented mode with a clear error", () => {
    expect(() => init({ mode: "consented", serviceName: "x" })).toThrowError(
      /consented.*not implemented/,
    );
  });
});

describe("structural no-op", () => {
  it("returns an inert client with no key, no endpoint, outside dev", () => {
    const pushState = history.pushState;
    const inert = init({
      mode: "cookieless",
      serviceName: "everr-docs-test",
    });
    client = inert;
    // No emitter built and nothing patched: pushState is untouched.
    expect(history.pushState).toBe(pushState);
  });
});
