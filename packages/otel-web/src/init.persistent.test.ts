import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./client.js";
import { identify, revoke } from "./session.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startPersistentClient,
  UNIQUE_ID,
} from "./test-kit.js";
import type { EverrClient } from "./types.js";

// localStorage persistence (the SDK default) through init(): the event
// schema is identical to memory persistence, only the ids are durable
// (everr.visitor.id and session.id across reloads and tabs). identify()'s
// user.* keys ride the in-memory ambient set either way; localStorage is
// the identity store, so every test starts and ends clean.

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(options?: { plugins?: [] }): void {
  [client, batches] = startPersistentClient(options);
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  revoke();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("init (persistence: localStorage)", () => {
  it("stamps the visitor id and a durable session id on every event", async () => {
    start();
    history.pushState(null, "", "/pricing");
    const all = await records();
    expect(all.length).toBeGreaterThan(0);
    const first = attrs(all[0]);
    expect(String(first["everr.visitor.id"])).toMatch(UNIQUE_ID);
    expect(String(first["session.id"])).toMatch(UNIQUE_ID);
    // The cookieless schema is unchanged: same event names, same envelope.
    expect(all[0].eventName).toBe("everr.browser.page_view");
    expect(first["everr.navigation.type"]).toBe("initial");
    for (const record of all) {
      expect(attrs(record)["everr.visitor.id"]).toBe(first["everr.visitor.id"]);
      expect(attrs(record)["session.id"]).toBe(first["session.id"]);
    }
    // No user until identify().
    expect(first).not.toHaveProperty("user.id");
  });

  it("survives a reload: the next init reuses the stored visitor and session", async () => {
    start();
    const [view] = await records();
    const before = attrs(view);
    await client?.shutdown();

    [client, batches] = startPersistentClient();
    const [reloaded] = await records();
    const after = attrs(reloaded);
    expect(after["everr.visitor.id"]).toBe(before["everr.visitor.id"]);
    expect(after["session.id"]).toBe(before["session.id"]);
  });

  it("shares visitor and session across concurrently open tabs", async () => {
    start();
    const [view] = await records();
    const first = attrs(view);

    // A second tab is a second init over the same localStorage while the
    // first client is still live.
    const [other, otherBatches] = startPersistentClient();
    await other.flush();
    const otherView = otherBatches
      .flatMap((b) => b.records)
      .find((r) => r.eventName === "everr.browser.page_view") as OtlpRecord;
    const second = attrs(otherView);
    expect(second["everr.visitor.id"]).toBe(first["everr.visitor.id"]);
    expect(second["session.id"]).toBe(first["session.id"]);
    // Reverse shutdown order keeps the history unpatching LIFO-correct.
    await other.shutdown();
  });

  it("rotates the session after a 30-minute idle gap, keeping the visitor id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    start();
    const [view] = await records();
    const before = attrs(view);

    // 31 idle minutes pass, then activity resumes with an SPA navigation.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    history.pushState(null, "", "/back-later");
    const all = await records();
    expect(all[all.length - 1].eventName).toBe("everr.browser.page_view");
    const rotated = attrs(all[all.length - 1]);
    expect(rotated["session.id"]).not.toBe(before["session.id"]);
    expect(rotated["everr.visitor.id"]).toBe(before["everr.visitor.id"]);
    // The rotated session persists: a reload inside its window keeps it.
    await client?.shutdown();
    [client, batches] = startPersistentClient();
    const [reloaded] = await records();
    expect(attrs(reloaded)["session.id"]).toBe(rotated["session.id"]);
  });

  it("stamps user.id and traits on events after identify, leaving earlier events untouched", async () => {
    start();
    const [viewBefore] = await records();

    identify("u_123", {
      plan: "pro",
      "company.name": "Acme",
    });
    history.pushState(null, "", "/dashboard");
    const all = await records();

    // The last record is the post-identify page_view.
    const after = attrs(all[all.length - 1]);
    expect(after["user.id"]).toBe("u_123");
    expect(after["user.plan"]).toBe("pro");
    expect(after["user.company.name"]).toBe("Acme");
    expect(after["everr.visitor.id"]).toBeDefined();
    // Stitching is query-time: the pre-identify view is byte-identical.
    expect(attrs(viewBefore)).not.toHaveProperty("user.id");
    expect(batches[0].records).toHaveLength(1);

    // The identification survives a same-page re-init (the ambient set is
    // module state); an actual reload starts unidentified, host re-identifies.
    await client?.shutdown();
    [client, batches] = startPersistentClient();
    const [reloaded] = await records();
    expect(attrs(reloaded)["user.id"]).toBe("u_123");
  });

  it("revoke() removes all stored ids; the next init starts fresh", async () => {
    start();
    identify("u_123", { plan: "pro" });
    const [view] = await records();
    const before = attrs(view);
    expect(localStorage.length).toBeGreaterThan(0);

    revoke();
    expect(localStorage.length).toBe(0);

    await client?.shutdown();
    [client, batches] = startPersistentClient();
    const [reloaded] = await records();
    const after = attrs(reloaded);
    expect(after["everr.visitor.id"]).not.toBe(before["everr.visitor.id"]);
    expect(after["session.id"]).not.toBe(before["session.id"]);
    expect(after).not.toHaveProperty("user.id");
  });

  it("emits nothing with no plugins", async () => {
    start({ plugins: [] });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("keeps identify()/revoke() safely inert in a keyless production build", () => {
    init({ serviceName: "everr-docs-test" });
    expect(localStorage.length).toBe(0);
    expect(() => {
      identify("u_123", { plan: "pro" });
      revoke();
    }).not.toThrow();
  });
});
