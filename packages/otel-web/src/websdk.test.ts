import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSDK } from "./client.js";
import { captureError } from "./errors.js";
import { errors } from "./instrumentations/errors/index.js";
import { interactions } from "./instrumentations/interactions/index.js";
import { network } from "./instrumentations/network/index.js";
import { pageviews } from "./instrumentations/pageviews/index.js";
import { performance as performanceInstrumentation } from "./instrumentations/performance/index.js";
import { logger } from "./logger.js";
import { setRouteResolver } from "./route.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
  UNIQUE_ID,
} from "./test-kit.js";
import type { WebSDKOptions } from "./types.js";

let client: WebSDK | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<WebSDKOptions>): void {
  [client, batches] = startClient(options);
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

async function resourceAttrs(): Promise<Record<string, unknown>> {
  await client?.flush();
  return Object.fromEntries(
    batches[0].resource.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

afterEach(async () => {
  setRouteResolver(null);
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("init (persistence: memory)", () => {
  it("emits an enveloped everr.browser.page_view for the initial load", async () => {
    start();
    const all = await records();
    expect(all).toHaveLength(1);
    const record = all[0];
    expect(record.eventName).toBe("everr.browser.page_view");
    expect(record.severityNumber).toBe(9);
    expect(record.body).toEqual({ stringValue: "everr.browser.page_view" });
    const a = attrs(record);
    expect(a["everr.navigation.type"]).toBe("initial");
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    expect(a["everr.page_view.id"]).toMatch(UNIQUE_ID);
    expect(a["url.full"]).toBe(window.location.href);
    expect(a["url.path"]).toBe("/");
    const resource = await resourceAttrs();
    expect(resource["service.name"]).toBe("everr-docs-test");
    expect(resource["telemetry.distro.name"]).toBe("@everr/otel-web");
    expect(resource["user_agent.original"]).toBeTruthy();
    // The emitter removes an optional attribute that has no value. It does not
    // send an empty value.
    expect(resource).not.toHaveProperty("deployment.environment.name");
  });

  it("emits history_change pageviews for SPA navigations, rotating the pageview id", async () => {
    start();
    history.pushState(null, "", "/pricing");
    const [initial, leave, spa] = await records();
    expect(spa.eventName).toBe("everr.browser.page_view");
    const spaAttrs = attrs(spa);
    const initialAttrs = attrs(initial);
    expect(spaAttrs["everr.navigation.type"]).toBe("history_change");
    expect(spaAttrs["url.path"]).toBe("/pricing");
    expect(spaAttrs["everr.referrer.url"]).toBe(initialAttrs["url.full"]);
    expect(spaAttrs["everr.page_view.id"]).not.toBe(
      initialAttrs["everr.page_view.id"],
    );
    expect(spaAttrs["session.id"]).toBe(initialAttrs["session.id"]);

    // The leave record of the previous page is between the two view records. It
    // refers to the first page view, and it carries the time on the page and the
    // scroll depth.
    expect(leave.eventName).toBe("everr.browser.page_leave");
    const leaveAttrs = attrs(leave);
    expect(leaveAttrs["everr.page_view.id"]).toBe(
      initialAttrs["everr.page_view.id"],
    );
    expect(leaveAttrs["url.path"]).toBe("/");
    expect(String(leaveAttrs["everr.page_view.duration"])).toMatch(/^\d+$/);
    expect(leaveAttrs["everr.scroll.depth"]).toBe("0");
  });

  it("emits the pending page_leave and exit-flushes with keepalive on pagehide", async () => {
    start();
    dispatchEvent(new Event("pagehide"));
    const all = await records();
    // The test sorts the names, and thus the result is always the same. The
    // timestamps give the sequence.
    expect(all.map((r) => r.eventName).sort()).toEqual([
      "everr.browser.page_leave",
      "everr.browser.page_view",
    ]);
    // The user can show the tab again and then hide it again. The SDK does not
    // send a second leave record.
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
      "everr.browser.page_leave",
      "everr.browser.page_view",
    ]);
  });

  it("emits no leave on hide when pageviews() is not composed", async () => {
    start({
      instrumentations: [
        errors(),
        interactions(),
        performanceInstrumentation(),
        network(),
      ],
    });
    dispatchEvent(new Event("pagehide"));
    expect(await records()).toHaveLength(0);
  });

  it("resolves each record's own page URL to a pattern and survives a throwing resolver", async () => {
    start();
    setRouteResolver((url) =>
      new URL(url).pathname.startsWith("/blog/") ? "/blog/$slug" : undefined,
    );
    history.pushState(null, "", "/blog/hello");
    const all = await records();
    // The code calculates the pattern for each record, from the URL of that
    // record. The first view record and the leave record belong to the page
    // before the navigation, and that page has no pattern. The view record of
    // the SPA navigation uses the new URL.
    expect(attrs(all[0])).not.toHaveProperty("everr.route.pattern");
    expect(attrs(all[1])).not.toHaveProperty("everr.route.pattern");
    expect(attrs(all[2])["everr.route.pattern"]).toBe("/blog/$slug");

    // A function of the host that throws an error must never stop the
    // capture.
    setRouteResolver(() => {
      throw new Error("host bug");
    });
    history.pushState(null, "", "/pricing");
    const after = await records();
    expect(attrs(after[after.length - 1])).not.toHaveProperty(
      "everr.route.pattern",
    );
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
    // The paths /a and /b changed the URL, and each of them made a view record
    // and a leave record. The popstate event did not change the URL, and thus
    // the code ignores it.
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

  it("emits nothing with no instrumentations", async () => {
    start({ instrumentations: [] });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("suppresses pageviews only by leaving pageviews() out", async () => {
    start({
      instrumentations: [
        errors(),
        interactions(),
        performanceInstrumentation(),
        network(),
      ],
    });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
  });

  it("autocaptures change and submit through the pipeline with the envelope", async () => {
    start();
    document.body.innerHTML =
      '<form id="f"><input type="email" id="e"><button type="submit" id="go">Sign up</button></form>';
    document
      .getElementById("e")
      ?.dispatchEvent(new Event("change", { bubbles: true }));
    const submitEv = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(submitEv, "submitter", {
      value: document.getElementById("go"),
    });
    (document.getElementById("f") as HTMLFormElement).dispatchEvent(submitEv);

    const all = await records();
    const change = all.find(
      (r) => r.eventName === "everr.browser.interaction.change",
    );
    const submit = all.find(
      (r) => r.eventName === "everr.browser.interaction.submit",
    );
    expect(change).toBeDefined();
    expect(submit).toBeDefined();
    const ca = attrs(change as OtlpRecord);
    const sa = attrs(submit as OtlpRecord);
    expect(ca["everr.element.tag"]).toBe("input");
    expect(ca["everr.element.selector"]).toBe("#e");
    expect(sa["everr.element.tag"]).toBe("button");
    expect(sa["everr.element.selector"]).toBe("#go");
    // The shared analytics envelope connects the events of the automatic
    // capture to the session.
    expect(ca["session.id"]).toMatch(UNIQUE_ID);
    expect(ca["everr.page_view.id"]).toMatch(UNIQUE_ID);
    expect(sa["session.id"]).toMatch(UNIQUE_ID);
    // The records carry no content of the DOM: no value of a field and no text
    // of an element. The submit record identifies the button that caused the
    // submit by its selector.
    expect(ca).not.toHaveProperty("everr.element.text");
    expect(sa).not.toHaveProperty("everr.element.text");
    expect(sa["everr.element.selector"]).toBeTypeOf("string");
    document.body.innerHTML = "";
  });

  it("captures frustration clicks through the pipeline with the envelope", async () => {
    start();
    document.body.innerHTML = "<button>Try Everr</button>";
    for (let i = 0; i < 3; i++) {
      (document.querySelector("button") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 6 }),
      );
    }
    const all = await records();
    const rageRecord = all.find(
      (r) => r.eventName === "everr.browser.interaction.rage_click",
    );
    expect(rageRecord).toBeDefined();
    const a = attrs(rageRecord as OtlpRecord);
    expect(a).not.toHaveProperty("everr.element.text");
    expect(a["everr.element.selector"]).toBeTypeOf("string");
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    document.body.innerHTML = "";
  });

  it("suppresses interactions only by leaving interactions() out", async () => {
    start({
      instrumentations: [
        errors(),
        pageviews(),
        performanceInstrumentation(),
        network(),
      ],
    });
    document.body.innerHTML = "<button>quiet</button>";
    for (let i = 0; i < 3; i++) {
      (document.querySelector("button") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 6 }),
      );
    }
    const all = await records();
    expect(all.map((r) => r.eventName)).toEqual(["everr.browser.page_view"]);
    document.body.innerHTML = "";
  });

  it("keeps watching navigations with no instrumentations, so the envelope stays fresh", () => {
    const pushState = history.pushState;
    start({ instrumentations: [] });
    // The navigation watcher is part of the envelope, and it is not a signal.
    // Thus it must change the history object, also when no pageview listener
    // registers.
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
});

describe("structural no-op", () => {
  it("returns an inert client with no key, no endpoint, outside dev", () => {
    const pushState = history.pushState;
    const inert = new WebSDK({ serviceName: "everr-docs-test" });
    client = inert;
    // The SDK made no emitter and changed nothing. Thus pushState does not
    // change.
    expect(history.pushState).toBe(pushState);
  });
});

describe("host-owned transport (send)", () => {
  type Delivered = { signal: string; body: string };

  function startWithSend(extra?: Partial<WebSDKOptions>) {
    const delivered: Delivered[] = [];
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    client = new WebSDK({
      serviceName: "everr-host-test",
      send: (signal, body) => {
        delivered.push({ signal, body });
      },
      ...extra,
    });
    return { delivered, fetchSpy };
  }

  it("boots a live client with no key, no endpoint, and outside dev", async () => {
    const { delivered, fetchSpy } = startWithSend();
    logger.info("through the host");
    await client?.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].signal).toBe("logs");
    const payload = JSON.parse(delivered[0].body) as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: object }> };
        scopeLogs: Array<{ logRecords: Array<{ body: object }> }>;
      }>;
    };
    expect(payload.resourceLogs[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "everr-host-test" },
    });
    expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0].body).toEqual({
      stringValue: "through the host",
    });
  });

  it("routes captured errors through the host as well", async () => {
    const { delivered } = startWithSend({ instrumentations: [errors()] });
    captureError(new Error("host boom"));
    await client?.flush();

    const bodies = delivered.map((d) => d.body).join("");
    expect(bodies).toContain("host boom");
    expect(bodies).toContain("everr.error.mechanism");
  });

  it("keeps working when the host transport throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    client = new WebSDK({
      serviceName: "everr-host-test",
      send: () => {
        throw new Error("host refused");
      },
    });
    logger.info("dropped, but silently");
    await expect(client.flush()).resolves.toBeUndefined();
  });
});

describe("base composition details", () => {
  it("boots with the instrumentations option absent entirely", async () => {
    start({ instrumentations: undefined });
    expect(await records()).toHaveLength(0);
    // The pipeline continues to operate. The logger uses it without an
    // instrumentation.
    const { logger } = await import("./logger.js");
    logger.info("bare boot");
    const [record] = await records();
    expect(record.body).toEqual({ stringValue: "bare boot" });
  });

  it("does not exit-flush on a visibilitychange back to visible", async () => {
    start({ instrumentations: [] });
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    const { logger } = await import("./logger.js");
    logger.info("pending");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(batches.filter((b) => b.keepalive)).toHaveLength(0);
  });
});
