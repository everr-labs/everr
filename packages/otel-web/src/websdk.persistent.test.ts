import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSDK } from "./client.js";
import { logger } from "./logger.js";
import { clearIdentity, identify, setAnonymized } from "./state/session.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
  startPersistentClient,
  UNIQUE_ID,
} from "./test-kit.js";

// The `anonymized: false` mode through new WebSDK(). The event schema is the
// same as the schema of the anonymized mode. Only the ids are permanent:
// everr.visitor.id and session.id continue after a reload and in the other
// tabs, and the records carry the user.* keys from identify(). The mode keeps
// the identity in localStorage. Thus each test clears it at the end.

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
  clearIdentity();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("init (anonymized: false)", () => {
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

  it("clearIdentity() removes all stored ids and the user; the next init starts fresh", async () => {
    start();
    identify("u_123", { plan: "pro" });
    const [view] = await records();
    const before = attrs(view);
    expect(localStorage.length).toBeGreaterThan(0);

    clearIdentity();
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

  it("keeps identify()/clearIdentity() safely inert in a keyless production build", () => {
    new WebSDK({ serviceName: "everr-docs-test" });
    expect(localStorage.length).toBe(0);
    expect(() => {
      identify("u_123", { plan: "pro" });
      clearIdentity();
    }).not.toThrow();
  });
});

describe("setAnonymized on a live client", () => {
  async function probe(): Promise<Record<string, unknown>> {
    logger.info("probe");
    const all = await records();
    return attrs(all[all.length - 1]);
  }

  const noUserKeys = (a: Record<string, unknown>): string[] =>
    Object.keys(a).filter((key) => key.startsWith("user."));

  it("keeps the session and adds the visitor id and the user when it leaves the mode", async () => {
    [client, batches] = startClient({ instrumentations: [] });
    identify("u_123", { plan: "pro" });
    const before = await probe();
    expect(before).not.toHaveProperty("everr.visitor.id");
    expect(noUserKeys(before)).toEqual([]);
    expect(localStorage.length).toBe(0);

    setAnonymized(false);
    const after = await probe();
    expect(after["session.id"]).toBe(before["session.id"]);
    expect(after["everr.visitor.id"]).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.visitor.id")).toBe(after["everr.visitor.id"]);
    expect(localStorage.getItem("everr.session")).toContain(String(after["session.id"]));
    expect(after["user.id"]).toBe("u_123");
    expect(after["user.plan"]).toBe("pro");
  });

  it("prefers a visitor id that localStorage already holds when it leaves the mode", async () => {
    [client, batches] = startClient({ instrumentations: [] });
    expect(await probe()).not.toHaveProperty("everr.visitor.id");
    localStorage.setItem("everr.visitor.id", "returning-visitor");

    setAnonymized(false);
    expect((await probe())["everr.visitor.id"]).toBe("returning-visitor");
  });

  it("removes the stored ids and starts a new session when it enters the mode", async () => {
    start({ instrumentations: [] });
    identify("u_123", { plan: "pro" });
    const before = await probe();
    expect(before["everr.visitor.id"]).toMatch(UNIQUE_ID);
    expect(before["user.id"]).toBe("u_123");
    expect(localStorage.length).toBe(2);

    setAnonymized(true);
    expect(localStorage.length).toBe(0);
    const anonymized = await probe();
    expect(anonymized).not.toHaveProperty("everr.visitor.id");
    expect(noUserKeys(anonymized)).toEqual([]);
    expect(anonymized["session.id"]).toMatch(UNIQUE_ID);
    expect(anonymized["session.id"]).not.toBe(before["session.id"]);
    expect(localStorage.length).toBe(0);

    // The identified user stays in memory. Thus it comes back without a second
    // call to identify.
    setAnonymized(false);
    const back = await probe();
    expect(back["user.id"]).toBe("u_123");
    expect(back["user.plan"]).toBe("pro");
    expect(back["everr.visitor.id"]).toMatch(UNIQUE_ID);
  });

  it("sends the queued records before it enters the mode, and no identity after", async () => {
    start({ instrumentations: [] });
    identify("u_123");
    logger.info("captured with consent");

    setAnonymized(true);
    const sent = () => batches.flatMap((b) => b.records).map(attrs);
    const atSwitch = sent();
    logger.info("captured anonymized");
    await client?.flush();
    const afterSwitch = sent().slice(atSwitch.length);

    expect(atSwitch).toHaveLength(1);
    expect(atSwitch[0]["everr.visitor.id"]).toMatch(UNIQUE_ID);
    expect(atSwitch[0]["user.id"]).toBe("u_123");
    expect(afterSwitch).toHaveLength(1);
    expect(afterSwitch[0]).not.toHaveProperty("everr.visitor.id");
    expect(noUserKeys(afterSwitch[0])).toEqual([]);
    expect(afterSwitch[0]["session.id"]).not.toBe(atSwitch[0]["session.id"]);
  });

  it("does nothing, and touches no storage, for the value that is already set", async () => {
    [client, batches] = startClient({ instrumentations: [] });
    const anonymizedSession = (await probe())["session.id"];
    const storageCalls = [
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
    ];
    setAnonymized(true);
    expect((await probe())["session.id"]).toBe(anonymizedSession);
    expect(storageCalls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);

    setAnonymized(false);
    const session = (await probe())["session.id"];
    for (const spy of storageCalls) spy.mockClear();
    setAnonymized(false);
    expect(storageCalls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect((await probe())["session.id"]).toBe(session);
  });

  it("clearIdentity() ends the identity in the current mode and keeps the mode", async () => {
    start({ instrumentations: [] });
    identify("u_123");
    const before = await probe();

    clearIdentity();
    expect(localStorage.length).toBe(0);
    const after = await probe();
    expect(noUserKeys(after)).toEqual([]);
    expect(after["session.id"]).not.toBe(before["session.id"]);
    expect(after["everr.visitor.id"]).toMatch(UNIQUE_ID);
    expect(after["everr.visitor.id"]).not.toBe(before["everr.visitor.id"]);
  });
});
