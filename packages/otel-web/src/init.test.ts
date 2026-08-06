import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./client.js";
import { setRouteResolver } from "./route.js";
import {
  allPlugins,
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
  UNIQUE_ID,
} from "./test-kit.js";
import type { EverrClient, InitOptions } from "./types.js";

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<InitOptions>): void {
  [client, batches] = startClient(options);
}

/** The full composition minus one plugin, the analog of the old disable. */
const without = (name: string) => allPlugins().filter((p) => p.name !== name);

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
    expect(resource["everr.sdk.name"]).toBe("@everr/otel-web");
    expect(resource["user_agent.original"]).toBeTruthy();
    // Unset optional attributes are filtered out, not shipped as empty values.
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

    // The outgoing page's leave sits between the two views, linked to the
    // initial pageview and carrying duration and scroll depth.
    expect(leave.eventName).toBe("everr.browser.page_leave");
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
    // Sort the names for a stable assertion; timestamps carry ordering.
    expect(all.map((r) => r.eventName).sort()).toEqual([
      "everr.browser.page_leave",
      "everr.browser.page_view",
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
      "everr.browser.page_leave",
      "everr.browser.page_view",
    ]);
  });

  it("emits no leave on hide when pageviews() is not composed", async () => {
    start({ plugins: without("pageviews") });
    dispatchEvent(new Event("pagehide"));
    expect(await records()).toHaveLength(0);
  });

  it("samples the registered route-pattern callback per record and survives a throwing one", async () => {
    let pattern: string | undefined;
    start();
    setRouteResolver(() => pattern);
    pattern = "/blog/$slug";
    history.pushState(null, "", "/blog/hello");
    const all = await records();
    // Sampled per record: the initial view predates the pattern, the SPA
    // navigation's leave and view carry it.
    expect(attrs(all[0])).not.toHaveProperty("everr.route.pattern");
    expect(attrs(all[2])["everr.route.pattern"]).toBe("/blog/$slug");

    // A throwing host callback must never break capture.
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

  it("emits nothing with no plugins", async () => {
    start({ plugins: [] });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("suppresses pageviews only by leaving pageviews() out", async () => {
    start({ plugins: without("pageviews") });
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
    // The shared analytics envelope makes autocaptured events join the session.
    expect(ca["session.id"]).toMatch(UNIQUE_ID);
    expect(ca["everr.page_view.id"]).toMatch(UNIQUE_ID);
    expect(sa["session.id"]).toMatch(UNIQUE_ID);
    // Element values are never carried, by construction.
    expect(ca).not.toHaveProperty("everr.element.text");
    // submit targets the submitter button and carries elementAttrs, which
    // includes the (non-field) button's visible label.
    expect(sa["everr.element.text"]).toBe("Sign up");
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
    expect(a["everr.element.text"]).toBe("Try Everr");
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    document.body.innerHTML = "";
  });

  it("suppresses interactions only by leaving interactions() out", async () => {
    start({ plugins: without("interactions") });
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

  it("keeps watching navigations with no plugins, so the envelope stays fresh", () => {
    const pushState = history.pushState;
    start({ plugins: [] });
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
});

describe("structural no-op", () => {
  it("returns an inert client with no key, no endpoint, outside dev", () => {
    const pushState = history.pushState;
    const inert = init({ serviceName: "everr-docs-test" });
    client = inert;
    // No emitter built and nothing patched: pushState is untouched.
    expect(history.pushState).toBe(pushState);
  });
});
