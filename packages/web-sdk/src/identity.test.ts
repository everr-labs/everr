import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindIdentity,
  createIdentity,
  identify,
  localStorageStore,
  memoryStore,
  revoke,
} from "./identity.js";
import { UNIQUE_ID } from "./test-kit.js";

// Unit tests for identity over the localStorage store: visitor id,
// 30-minute-inactivity sessions, identify() stamping, and revoke()
// deletion. Time is mocked via Date.now (the only clock the session
// provider reads). The memory store shares all of this logic; its
// page-lifetime semantics are covered in init.test.ts.

const KEYS = ["everr.visitor.id", "everr.session", "everr.user"];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("identify()/revoke() live binding", () => {
  // Must run before any bindIdentity() in this file: the pre-bind sink is
  // module-level state that binding permanently replaces.
  it("warns instead of throwing before any client binds identity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => identify("u_1")).not.toThrow();
      expect(() => revoke()).not.toThrow();
      expect(warn).toHaveBeenCalledWith("[everr] SDK not initialized");
    } finally {
      warn.mockRestore();
    }
  });

  it("routes to the bound identity while live", () => {
    const identity = createIdentity(localStorageStore);
    const unbind = bindIdentity(identity);
    try {
      identify("u_123", { plan: "pro" });
      expect(identity.attrs()["user.id"]).toBe("u_123");
      revoke();
      expect(localStorage.length).toBe(0);
    } finally {
      unbind();
    }
  });

  it("goes silent after unbind instead of warning", () => {
    const unbind = bindIdentity(createIdentity(localStorageStore));
    unbind();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => identify("u_1")).not.toThrow();
      expect(() => revoke()).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("memory store", () => {
  it("keeps every id out of localStorage and dies with the instance", () => {
    const identity = createIdentity(memoryStore());
    identity.identify("u_1", { plan: "pro" });
    identity.session();
    expect(identity.attrs()["user.id"]).toBe("u_1");
    expect(localStorage.length).toBe(0);
    // A fresh store (a reload) knows nothing.
    const fresh = createIdentity(memoryStore());
    expect(fresh.attrs()).not.toHaveProperty("user.id");
    expect(fresh.attrs()["everr.visitor.id"]).not.toBe(
      identity.attrs()["everr.visitor.id"],
    );
  });
});

describe("visitor id", () => {
  it("mints a random persistent id and reads it back on the next init", () => {
    const first = createIdentity(localStorageStore);
    const visitorId = first.attrs()["everr.visitor.id"];
    expect(String(visitorId)).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.visitor.id")).toBe(visitorId);
    // A reload (a fresh identity over the same storage) reuses it.
    expect(createIdentity(localStorageStore).attrs()["everr.visitor.id"]).toBe(
      visitorId,
    );
  });
});

describe("durable session", () => {
  it("keeps the session id across calls and touches the activity timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const identity = createIdentity(localStorageStore);
    const id = identity.session();
    expect(id).toMatch(UNIQUE_ID);

    // 20 idle minutes: inside the window, same session.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 20 * 60_000);
    expect(identity.session()).toBe(id);
    // Another 20 idle minutes from the touch: still inside, still the same.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 40 * 60_000);
    expect(identity.session()).toBe(id);
  });

  it("rotates the session after a 30-minute idle gap", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const identity = createIdentity(localStorageStore);
    const id = identity.session();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    const rotated = identity.session();
    expect(rotated).not.toBe(id);
    // The rotated session persists (a reload inside its window reuses it).
    expect(createIdentity(localStorageStore).session()).toBe(rotated);
  });

  it("survives a reload inside the inactivity window", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const id = createIdentity(localStorageStore).session();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 5 * 60_000);
    expect(createIdentity(localStorageStore).session()).toBe(id);
  });

  it("mints a fresh session over corrupt stored state", () => {
    localStorage.setItem("everr.session", "not json");
    const id = createIdentity(localStorageStore).session();
    expect(id).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.session")).toContain(id);
  });

  it("degrades to in-memory continuity when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const identity = createIdentity(localStorageStore);
    const id = identity.session();
    // Without the in-memory fallback every call would mint a fresh id.
    expect(identity.session()).toBe(id);
    expect(identity.attrs()["everr.visitor.id"]).toMatch(UNIQUE_ID);
  });
});

describe("identify", () => {
  it("stamps only the visitor id before identify", () => {
    const attrs = createIdentity(localStorageStore).attrs();
    expect(attrs["everr.visitor.id"]).toMatch(UNIQUE_ID);
    expect(attrs).not.toHaveProperty("user.id");
  });

  it("stamps user.id and flattened traits after identify", () => {
    const identity = createIdentity(localStorageStore);
    identity.identify("u_123", {
      plan: "pro",
      seats: 42,
      beta: true,
      company: { name: "Acme", address: { city: "Springfield" } },
      // Arrays are rejected by the UserTraits type; a JS caller bypassing
      // the compiler gets them dropped at flatten time instead.
      tags: ["dropped"] as unknown as string,
      ref: null,
    });
    expect(identity.attrs()).toEqual({
      "everr.visitor.id": expect.stringMatching(UNIQUE_ID),
      "user.id": "u_123",
      "user.plan": "pro",
      "user.seats": 42,
      "user.beta": true,
      "user.company.name": "Acme",
      "user.company.address.city": "Springfield",
    });
  });

  it("never lets a trait shadow the identified user id", () => {
    const identity = createIdentity(localStorageStore);
    identity.identify("u_123", { id: "spoofed" });
    expect(identity.attrs()["user.id"]).toBe("u_123");
  });

  it("is latest-wins: a re-identify replaces id and traits wholesale", () => {
    const identity = createIdentity(localStorageStore);
    identity.identify("u_123", { plan: "pro" });
    identity.identify("u_456");
    const attrs = identity.attrs();
    expect(attrs["user.id"]).toBe("u_456");
    expect(attrs).not.toHaveProperty("user.plan");
  });

  it("persists the identified user across a reload", () => {
    createIdentity(localStorageStore).identify("u_123", { plan: "pro" });
    const attrs = createIdentity(localStorageStore).attrs();
    expect(attrs["user.id"]).toBe("u_123");
    expect(attrs["user.plan"]).toBe("pro");
  });
});

describe("revoke", () => {
  it("deletes every stored id so the next init starts fresh", () => {
    const identity = createIdentity(localStorageStore);
    identity.identify("u_123", { plan: "pro" });
    identity.session();
    const visitorId = identity.attrs()["everr.visitor.id"];
    expect(localStorage.length).toBe(KEYS.length);

    identity.revoke();
    expect(localStorage.length).toBe(0);
    for (const key of KEYS) expect(localStorage.getItem(key)).toBeNull();

    // The next init mints new ids and knows no user.
    const fresh = createIdentity(localStorageStore);
    expect(fresh.attrs()["everr.visitor.id"]).not.toBe(visitorId);
    expect(fresh.session()).not.toBe(identity.session());
    expect(fresh.attrs()).not.toHaveProperty("user.id");
  });

  it("never downgrades the live client in place", () => {
    const identity = createIdentity(localStorageStore);
    identity.identify("u_123");
    identity.revoke();
    // The CMP drives the transition by reloading; until then the live
    // handle keeps its in-memory identity.
    expect(identity.attrs()["user.id"]).toBe("u_123");
    // A later identify() still works in memory but persists nothing back.
    identity.identify("u_456");
    expect(identity.attrs()["user.id"]).toBe("u_456");
    expect(localStorage.getItem("everr.user")).toBeNull();
  });
});
