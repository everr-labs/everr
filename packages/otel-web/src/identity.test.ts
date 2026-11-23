import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getAttributes, setAttributes } from "./state/attributes.js";
import {
  clearIdentity,
  identify,
  persistSession,
  sessionId,
  setAnonymized,
  userAttributes,
  visitorId,
} from "./state/session.js";
import { UNIQUE_ID } from "./test-kit.js";

// Unit tests for the identity. They examine the visitor id, the sessions that
// end after 30 minutes without activity, a change of the mode during a session,
// and the user.* keys from identify().
//
// The tests replace Date.now, which is the only clock that the session code
// reads. Before and after each test, the code returns to the anonymized mode,
// it forgets the user and the ids, and it empties localStorage.

function reset(): void {
  setAnonymized(true);
  clearIdentity();
  localStorage.clear();
}

beforeEach(reset);

afterEach(() => {
  reset();
  // The test can leave other ambient keys. Remove them too.
  setAttributes(Object.fromEntries(Object.keys(getAttributes()).map((key) => [key, null])));
  vi.restoreAllMocks();
});

describe("visitor id", () => {
  it("mints a random persistent id and reads it back on the next resolve", () => {
    setAnonymized(false);
    const id = visitorId();
    expect(id).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.visitor.id")).toBe(id);
    expect(visitorId()).toBe(id);
  });

  it("has no id and keeps localStorage empty while anonymized", () => {
    expect(visitorId()).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });
});

describe("durable session", () => {
  it("keeps the session id across calls and touches the activity timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setAnonymized(false);
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
    setAnonymized(false);
    const id = sessionId();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    const rotated = sessionId();
    expect(rotated).not.toBe(id);
    // The code wrote the new session to the store. Thus a reload in its window
    // uses that session again.
    expect(localStorage.getItem("everr.session")).toContain(rotated);
  });

  it("mints a fresh session over corrupt stored state", () => {
    setAnonymized(false);
    localStorage.setItem("everr.session", "not json");
    const id = sessionId();
    expect(id).toMatch(UNIQUE_ID);
    expect(localStorage.getItem("everr.session")).toContain(id);
  });

  it("degrades to in-memory continuity when storage is unavailable", () => {
    setAnonymized(false);
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

describe("setAnonymized", () => {
  it("keeps the live session and writes it with a visitor id when leaving the mode", () => {
    const session = sessionId();
    expect(localStorage.length).toBe(0);

    setAnonymized(false);
    const visitor = visitorId();
    expect(visitor).toMatch(UNIQUE_ID);
    expect(sessionId()).toBe(session);
    expect(localStorage.getItem("everr.visitor.id")).toBe(visitor);
    expect(localStorage.getItem("everr.session")).toContain(session);
  });

  it("prefers an id that localStorage already holds when leaving the mode", () => {
    localStorage.setItem("everr.visitor.id", "returning-visitor");
    setAnonymized(false);
    expect(visitorId()).toBe("returning-visitor");
    expect(localStorage.getItem("everr.visitor.id")).toBe("returning-visitor");
  });

  it("removes the stored ids and starts a new session when entering the mode", () => {
    setAnonymized(false);
    const session = sessionId();
    expect(localStorage.length).toBe(2);

    setAnonymized(true);
    expect(localStorage.length).toBe(0);
    expect(visitorId()).toBeUndefined();
    expect(sessionId()).not.toBe(session);
    expect(localStorage.length).toBe(0);
  });

  it("does nothing, and touches no storage, when the value does not change", () => {
    const calls = [
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
    ];
    const anonymizedSession = sessionId();
    setAnonymized(true);
    expect(sessionId()).toBe(anonymizedSession);
    expect(calls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);

    setAnonymized(false);
    const session = sessionId();
    for (const spy of calls) spy.mockClear();
    setAnonymized(false);
    expect(calls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect(sessionId()).toBe(session);
  });
});

describe("identify", () => {
  it("writes user.id and flat traits into the user, never storage or the ambient set", () => {
    setAnonymized(false);
    identify("u_123", {
      plan: "pro",
      seats: 42,
      beta: true,
      "company.name": "Acme",
      ref: null,
    });
    expect(userAttributes()).toEqual({
      "user.id": "u_123",
      "user.plan": "pro",
      "user.seats": 42,
      "user.beta": true,
      "user.company.name": "Acme",
    });
    expect(getAttributes()).toEqual({});
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("u_123");
  });

  it("never lets a trait shadow the identified user id", () => {
    setAnonymized(false);
    identify("u_123", { id: "spoofed" });
    expect(userAttributes()?.["user.id"]).toBe("u_123");
  });

  it("is latest-wins: a re-identify replaces the user.* namespace wholesale", () => {
    setAnonymized(false);
    identify("u_123", { plan: "pro" });
    identify("u_456");
    expect(userAttributes()).toEqual({ "user.id": "u_456" });
  });

  it("holds the user in memory while anonymized and exposes none", () => {
    identify("u_123", { plan: "pro" });
    expect(userAttributes()).toBeUndefined();
    setAnonymized(false);
    expect(userAttributes()).toEqual({ "user.id": "u_123", "user.plan": "pro" });
    setAnonymized(true);
    expect(userAttributes()).toBeUndefined();
    setAnonymized(false);
    expect(userAttributes()?.["user.id"]).toBe("u_123");
  });

  it("leaves the other ambient attributes alone", () => {
    setAttributes({ "everr.team": "core" });
    identify("u1", { plan: "pro" });
    expect(getAttributes()).toEqual({ "everr.team": "core" });
  });
});

describe("clearIdentity", () => {
  it("forgets the user and the stored ids, and keeps the mode", () => {
    setAnonymized(false);
    identify("u_123", { plan: "pro" });
    const visitor = visitorId();
    const session = sessionId();
    expect(localStorage.length).toBe(2);

    clearIdentity();
    expect(localStorage.length).toBe(0);
    expect(userAttributes()).toEqual({});
    // The mode is still not anonymized. Thus the next ids are new and the code
    // stores them.
    expect(visitorId()).not.toBe(visitor);
    expect(sessionId()).not.toBe(session);
    expect(localStorage.length).toBe(2);
  });

  it("forgets the user and the session without a storage call while anonymized", () => {
    identify("u_123");
    const session = sessionId();
    const calls = [
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
    ];

    clearIdentity();
    expect(sessionId()).not.toBe(session);
    expect(calls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    setAnonymized(false);
    expect(userAttributes()).toEqual({});
  });
});

describe("session write throttle", () => {
  it("writes the activity on a delay, not for each record", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setAnonymized(false);
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
    setAnonymized(false);
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
    setAnonymized(false);
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

  it("keeps an active session after a consent that stored an old activity", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const id = sessionId();

    // The consent comes 20 minutes after the last record. The store then holds
    // the activity of minute 0.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 20 * 60_000);
    setAnonymized(false);
    expect(sessionId()).toBe(id);

    // 11 minutes without activity is inside the timeout.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    expect(sessionId()).toBe(id);
  });

  it("keeps an active session after an exit path that stored an old activity", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setAnonymized(false);
    const id = sessionId();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 20 * 60_000);
    persistSession();
    expect(sessionId()).toBe(id);

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 31 * 60_000);
    expect(sessionId()).toBe(id);
  });
});

describe("session timeout boundary", () => {
  it("keeps the session at exactly 30 minutes of inactivity, rotates past it", () => {
    vi.useFakeTimers();
    try {
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
