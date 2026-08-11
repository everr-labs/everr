import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAttributes, setAttributes } from "./attributes.js";
import {
  identify,
  persistSession,
  revoke,
  sessionId,
  setPersistence,
  visitorId,
} from "./session.js";
import { UNIQUE_ID } from "./test-kit.js";

// Unit tests for the identity on the current store. They examine the visitor
// id, the sessions that end after 30 minutes without activity, a change of the
// store during a session, and the user.* keys from identify() and revoke() in
// the ambient set of setAttributes.
//
// The tests replace Date.now, which is the only clock that the session code
// reads. The revoke() function also sets the initial condition before each test:
// it removes the ids from the store, it removes the ambient user.* keys, it
// removes the session in memory, and it installs a memory store.

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
    // The revoke() function removes all the data. Thus the next call finds
    // nothing.
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

    // After 20 minutes without activity, the time is in the window, and thus
    // the session is the same.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 20 * 60_000);
    expect(sessionId()).toBe(id);
    // After 20 more minutes without activity from the last activity, the time
    // is still in the window, and the session is still the same.
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
    // The code wrote the new session to the store. Thus a reload in its window
    // uses that session again.
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
    // Without the session in memory, each call makes a new id.
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
    // The code makes new ids in a memory store. Thus it writes nothing to a
    // permanent store.
    expect(visitorId()).not.toBe(visitor);
    expect(sessionId()).not.toBe(session);
    expect(localStorage.length).toBe(0);
  });
});

describe("identify scoping", () => {
  it("replaces only the user.* namespace, keeping other ambient attributes", () => {
    setAttributes({ "everr.team": "core" });
    identify("u1", { plan: "pro" });
    identify("u2");
    const set = getAttributes();
    expect(set["everr.team"]).toBe("core");
    expect(set["user.id"]).toBe("u2");
    // The second call to identify removed all the traits of the previous
    // user.
    expect(set).not.toHaveProperty("user.plan");
  });
});

describe("session write throttle", () => {
  it("writes the activity on a delay, not for each record", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setPersistence("localStorage");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    // The first call makes the session. A new id always writes immediately,
    // because no other tab can find it in memory.
    const id = sessionId();
    expect(setItem).toHaveBeenCalledTimes(1);

    // The next 50 records are inside the delay. Thus they change the activity
    // in memory only, and the main thread does no write.
    for (let i = 0; i < 50; i++) sessionId();
    expect(setItem).toHaveBeenCalledTimes(1);

    // After the delay, one record writes the activity again.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 30_000);
    expect(sessionId()).toBe(id);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("everr.session")).toContain(id);
  });

  it("keeps the timeout correct when the store is behind the activity", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setPersistence("localStorage");
    const id = sessionId();

    // Activity in each minute for 40 minutes. The store keeps a value that is
    // a maximum of 30 seconds old, but the session in memory is current. Thus
    // the session does not end.
    for (let minute = 1; minute <= 40; minute++) {
      vi.spyOn(Date, "now").mockReturnValue(1_000_000 + minute * 60_000);
      expect(sessionId()).toBe(id);
    }
  });

  it("persistSession writes the activity immediately on the exit path", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setPersistence("localStorage");
    const id = sessionId();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 5_000);
    sessionId(); // inside the delay: memory only
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    persistSession();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("everr.session")).toBe(
      JSON.stringify({ id, t: 1_000_000 + 5_000 }),
    );
  });
});

describe("session timeout boundary", () => {
  it("keeps the session at exactly 30 minutes of inactivity, rotates past it", () => {
    vi.useFakeTimers();
    try {
      setPersistence("memory");
      const first = sessionId();
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(sessionId()).toBe(first); // exactly at the timeout: same session
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(sessionId()).not.toBe(first); // one ms past: a fresh session
    } finally {
      vi.useRealTimers();
    }
  });
});
