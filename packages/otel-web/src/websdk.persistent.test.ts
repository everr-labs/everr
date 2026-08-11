import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSDK } from "./client.js";
import { identify, revoke } from "./state/session.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startPersistentClient,
  UNIQUE_ID,
} from "./test-kit.js";

// The localStorage store through new WebSDK(). That store is the default of the
// SDK. The event schema is the same as the schema with the memory store. Only
// the ids are permanent: everr.visitor.id and session.id continue after a reload
// and in the other tabs. With the two stores, the user.* keys from identify()
// are in the ambient set in memory. The localStorage store holds the identity.
// Thus each test clears it at the start and at the end.

let client: WebSDK | undefined;
let batches: OtlpBatch[];

function start(options?: { instrumentations?: [] }): void {
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
    // The schema without cookies does not change: the event names are the same,
    // and the envelope is the same.
    expect(all[0].eventName).toBe("everr.browser.page_view");
    expect(first["everr.navigation.type"]).toBe("initial");
    for (const record of all) {
      expect(attrs(record)["everr.visitor.id"]).toBe(first["everr.visitor.id"]);
      expect(attrs(record)["session.id"]).toBe(first["session.id"]);
    }
    // There is no user until a call to identify().
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

    // A second tab is a second construction on the same localStorage store,
    // while the first client continues to operate.
    const [other, otherBatches] = startPersistentClient();
    await other.flush();
    const otherView = otherBatches
      .flatMap((b) => b.records)
      .find((r) => r.eventName === "everr.browser.page_view") as OtlpRecord;
    const second = attrs(otherView);
    expect(second["everr.visitor.id"]).toBe(first["everr.visitor.id"]);
    expect(second["session.id"]).toBe(first["session.id"]);
    // The test stops the clients in the opposite sequence. Thus the code
    // restores the history object correctly, because the last change comes back
    // first.
    await other.shutdown();
  });

  it("rotates the session after a 30-minute idle gap, keeping the visitor id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    start();
    const [view] = await records();
    const before = attrs(view);

    // There are 31 minutes without activity. Then an SPA navigation starts the
    // activity again.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    history.pushState(null, "", "/back-later");
    const all = await records();
    expect(all[all.length - 1].eventName).toBe("everr.browser.page_view");
    const rotated = attrs(all[all.length - 1]);
    expect(rotated["session.id"]).not.toBe(before["session.id"]);
    expect(rotated["everr.visitor.id"]).toBe(before["everr.visitor.id"]);
    // The code wrote the new session to the store. Thus a reload in its window
    // keeps that session.
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

    // The last record is the page_view record after the call to identify.
    const after = attrs(all[all.length - 1]);
    expect(after["user.id"]).toBe("u_123");
    expect(after["user.plan"]).toBe("pro");
    expect(after["user.company.name"]).toBe("Acme");
    expect(after["everr.visitor.id"]).toBeDefined();
    // A query connects the records later. Thus the view record before the call
    // to identify does not change.
    expect(attrs(viewBefore)).not.toHaveProperty("user.id");
    expect(batches[0].records).toHaveLength(1);

    // The identification continues after a new construction on the same page,
    // because the ambient set is module data. After a true reload the page
    // starts with no identification, and the host identifies the user again.
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

  it("emits nothing with no instrumentations", async () => {
    start({ instrumentations: [] });
    history.pushState(null, "", "/nope");
    expect(await records()).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("keeps identify()/revoke() safely inert in a keyless production build", () => {
    // A production build has no local collector. Thus a client with no key
    // finds no transport, and it writes no identity to the store.
    vi.stubEnv("NODE_ENV", "production");
    new WebSDK({ serviceName: "everr-docs-test" });
    vi.unstubAllEnvs();
    expect(localStorage.length).toBe(0);
    expect(() => {
      identify("u_123", { plan: "pro" });
      revoke();
    }).not.toThrow();
  });
});
