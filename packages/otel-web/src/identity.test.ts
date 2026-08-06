import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAttributes } from "./attributes.js";
import {
  identify,
  revoke,
  sessionId,
  setPersistence,
  visitorId,
} from "./session.js";
import { UNIQUE_ID } from "./test-kit.js";

// Unit tests for identity over the current store: visitor id, 30-minute
// inactivity sessions, mid-session persistence switching, and the
// identify()/revoke() user.* keys in the setAttributes ambient set. Time is
// mocked via Date.now (the only clock the session provider reads). revoke()
// doubles as the between-test reset: it clears the stored ids, the ambient
// user.*, the in-memory session continuity, and swaps in a memory store.

beforeEach(() => {
  localStorage.clear();
  revoke();
});

afterEach(() => {
  revoke();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("visitor id", () => {
  it("mints a random persistent id and reads it back on the next resolve", () => {
    setPersistence("localStorage");
    const id = visitorId();
    expect(id).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.visitor.id")).toBe(id);
    expect(visitorId()).toBe(id);
  });

  it("keeps memory-persistence ids out of localStorage", () => {
    setPersistence("memory");
    const id = visitorId();
    expect(localStorage.length).toBe(0);
    // revoke() drops everything; the next resolve knows nothing.
    revoke();
    expect(visitorId()).not.toBe(id);
  });
});

describe("durable session", () => {
  it("keeps the session id across calls and touches the activity timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setPersistence("localStorage");
    const id = sessionId();
    expect(id).toMatch(UNIQUE_ID);

    // 20 idle minutes: inside the window, same session.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 20 * 60_000);
    expect(sessionId()).toBe(id);
    // Another 20 idle minutes from the touch: still inside, still the same.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 40 * 60_000);
    expect(sessionId()).toBe(id);
  });

  it("rotates the session after a 30-minute idle gap", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setPersistence("localStorage");
    const id = sessionId();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    const rotated = sessionId();
    expect(rotated).not.toBe(id);
    // The rotated session persisted: a reload inside its window reuses it.
    expect(localStorage.getItem("everr.session")).toContain(rotated);
  });

  it("mints a fresh session over corrupt stored state", () => {
    setPersistence("localStorage");
    localStorage.setItem("everr.session", "not json");
    const id = sessionId();
    expect(id).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.session")).toContain(id);
  });

  it("degrades to in-memory continuity when storage is unavailable", () => {
    setPersistence("localStorage");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const id = sessionId();
    // Without the in-memory fallback every call would mint a fresh id.
    expect(sessionId()).toBe(id);
    expect(visitorId()).toMatch(UNIQUE_ID);
  });
});

describe("setPersistence", () => {
  it("carries the live ids into the new store on a consent upgrade", () => {
    setPersistence("memory");
    const visitor = visitorId();
    const session = sessionId();
    expect(localStorage.length).toBe(0);

    setPersistence("localStorage");
    expect(visitorId()).toBe(visitor);
    expect(sessionId()).toBe(session);
    expect(localStorage.getItem("everr.visitor.id")).toBe(visitor);
  });

  it("prefers an id the durable store already holds", () => {
    localStorage.setItem("everr.visitor.id", "returning-visitor");
    setPersistence("memory");
    visitorId();
    setPersistence("localStorage");
    expect(visitorId()).toBe("returning-visitor");
  });
});

describe("identify", () => {
  it("writes user.id and flat traits into the ambient set, never storage", () => {
    identify("u_123", {
      plan: "pro",
      seats: 42,
      beta: true,
      "company.name": "Acme",
      ref: null,
    });
    expect(getAttributes()).toEqual({
      "user.id": "u_123",
      "user.plan": "pro",
      "user.seats": 42,
      "user.beta": true,
      "user.company.name": "Acme",
    });
    expect(localStorage.length).toBe(0);
  });

  it("never lets a trait shadow the identified user id", () => {
    identify("u_123", { id: "spoofed" });
    expect(getAttributes()["user.id"]).toBe("u_123");
  });

  it("is latest-wins: a re-identify replaces the user.* namespace wholesale", () => {
    identify("u_123", { plan: "pro" });
    identify("u_456");
    expect(getAttributes()["user.id"]).toBe("u_456");
    expect(getAttributes()).not.toHaveProperty("user.plan");
  });
});

describe("revoke", () => {
  it("clears user.* and every stored id so the next resolve starts fresh", () => {
    setPersistence("localStorage");
    identify("u_123", { plan: "pro" });
    const visitor = visitorId();
    const session = sessionId();
    expect(localStorage.length).toBe(2);

    revoke();
    expect(localStorage.length).toBe(0);
    expect(getAttributes()).not.toHaveProperty("user.id");
    // Fresh ids, minted into a memory store: nothing re-persists.
    expect(visitorId()).not.toBe(visitor);
    expect(sessionId()).not.toBe(session);
    expect(localStorage.length).toBe(0);
  });
});
