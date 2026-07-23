import { SeverityNumber } from "@opentelemetry/api-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { afterEach, describe, expect, it } from "vitest";
import { initInternal } from "./client.js";
import type { CaptureConfig, EverrClient } from "./types.js";

let client: EverrClient | undefined;
let exporter: InMemoryLogRecordExporter;

function start(options?: { capture?: CaptureConfig }): void {
  exporter = new InMemoryLogRecordExporter();
  client = initInternal(
    {
      mode: "cookieless",
      serviceName: "everr-docs-test",
      dev: true,
      capture: options?.capture,
    },
    { exporter },
  );
}

function records() {
  return exporter.getFinishedLogRecords();
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  history.replaceState(null, "", "/");
});

describe("init (cookieless)", () => {
  it("emits an enveloped browser.page_view for the initial load", () => {
    start();
    expect(records()).toHaveLength(1);
    const record = records()[0];
    expect(record.eventName).toBe("browser.page_view");
    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    expect(record.body).toBeUndefined();
    expect(record.attributes["everr.navigation.type"]).toBe("initial");
    expect(record.attributes["session.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(record.attributes["everr.page_view.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(record.attributes["everr.event.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(record.attributes["url.full"]).toBe(window.location.href);
    expect(record.attributes["url.path"]).toBe("/");
    expect(record.resource.attributes["service.name"]).toBe("everr-docs-test");
    expect(record.resource.attributes["everr.sdk.name"]).toBe("@everr/web-sdk");
    expect(record.resource.attributes["user_agent.original"]).toBeTruthy();
  });

  it("emits history_change pageviews for SPA navigations, rotating the pageview id", () => {
    start();
    history.pushState(null, "", "/pricing");
    expect(records()).toHaveLength(2);
    const [initial, spa] = records();
    expect(spa.eventName).toBe("browser.page_view");
    expect(spa.attributes["everr.navigation.type"]).toBe("history_change");
    expect(spa.attributes["url.path"]).toBe("/pricing");
    expect(spa.attributes["everr.referrer.url"]).toBe(
      initial.attributes["url.full"],
    );
    expect(spa.attributes["everr.page_view.id"]).not.toBe(
      initial.attributes["everr.page_view.id"],
    );
    expect(spa.attributes["session.id"]).toBe(initial.attributes["session.id"]);
  });

  it("does not emit for a pushState to the same URL", () => {
    start();
    history.pushState(null, "", window.location.href);
    expect(records()).toHaveLength(1);
  });

  it("emits on popstate navigations", () => {
    start();
    history.pushState(null, "", "/a");
    history.replaceState(null, "", "/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    // /a and /b changed the URL; the popstate with an unchanged URL is deduped.
    expect(records()).toHaveLength(3);
  });

  it("writes zero cookies and zero storage", () => {
    start();
    history.pushState(null, "", "/anywhere");
    expect(document.cookie).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("emits nothing with capture: false", () => {
    start({ capture: false });
    history.pushState(null, "", "/nope");
    expect(records()).toHaveLength(0);
  });

  it("suppresses pageviews only with capture: { pageviews: false }", () => {
    start({ capture: { pageviews: false } });
    history.pushState(null, "", "/nope");
    expect(records()).toHaveLength(0);
  });

  it("keeps watching navigations when pageviews are off, so the envelope stays fresh", () => {
    start({ capture: { pageviews: false } });
    // The navigation watcher is envelope infrastructure, not a signal: it
    // must patch history even when no pageview listener is registered.
    expect(history.pushState.toString()).not.toContain("native code");
  });

  it("stops emitting and unpatches history after shutdown", async () => {
    start();
    expect(records()).toHaveLength(1);
    const pushState = history.pushState;
    await client?.shutdown();
    // The in-memory exporter clears on shutdown; nothing new may arrive.
    expect(history.pushState).not.toBe(pushState);
    history.pushState(null, "", "/after-shutdown");
    expect(records()).toHaveLength(0);
    client = undefined;
  });

  it("rejects consented mode with a clear error", () => {
    expect(() =>
      initInternal({ mode: "consented", serviceName: "x" }),
    ).toThrowError(/consented.*not implemented/);
  });
});

describe("structural no-op", () => {
  it("returns an inert client with no key, no endpoint, outside dev", () => {
    const inert = initInternal({
      mode: "cookieless",
      serviceName: "everr-docs-test",
    });
    client = inert;
    expect(inert.mode).toBe("cookieless");
    // No records anywhere and nothing patched: pushState stays native.
    expect(history.pushState.toString()).toContain("native code");
  });
});
