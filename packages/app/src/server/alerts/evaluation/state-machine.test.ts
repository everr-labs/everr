import { describe, expect, it } from "vitest";
import {
  advanceAlertInstance,
  newInactiveInstance,
  type PresentAlertInstance,
} from "./state-machine";

const present: PresentAlertInstance = {
  fingerprint: "one",
  labels: { service: "api" },
  evidence: { value: 1 },
  value: 1,
};

const at = (seconds: number) => new Date(seconds * 1000);

describe("advanceAlertInstance", () => {
  it("fires immediately when for is zero", () => {
    const result = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 0,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    expect(result.next.status).toBe("firing");
    expect(result.event).toBe("firing");
  });

  it("waits for the pending duration", () => {
    const first = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    const second = advanceAlertInstance({
      previous: first.next,
      present,
      evaluatedAt: at(60),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    expect(first.next.status).toBe("pending");
    expect(second.next.status).toBe("firing");
    expect(second.event).toBe("firing");
  });

  it("restarts the pending clock after an absorbed gap", () => {
    const first = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 60,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const absent = advanceAlertInstance({
      previous: first.next,
      present: undefined,
      evaluatedAt: at(30),
      forSeconds: 60,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const reappeared = advanceAlertInstance({
      previous: absent.next,
      present,
      evaluatedAt: at(60),
      forSeconds: 60,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    expect(reappeared.next.status).toBe("pending");
    expect(reappeared.next.pendingSince).toEqual(at(60));
  });

  it("does not fire on the first evaluation after an outage", () => {
    // The engine stopped for five hours with the instance pending. Nothing
    // observed the condition in that window, so `for` has not been satisfied:
    // an absence during the outage would have looked exactly the same.
    const pending = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 600,
      resolveAfter: 3,
      intervalSeconds: 60,
    });
    const afterOutage = advanceAlertInstance({
      previous: pending.next,
      present,
      evaluatedAt: at(18_000),
      forSeconds: 600,
      resolveAfter: 3,
      intervalSeconds: 60,
    });

    expect(pending.next.status).toBe("pending");
    expect(afterOutage.next.status).toBe("pending");
    expect(afterOutage.event).toBeNull();
    // The clock restarts, so firing needs a fresh `for` of observed holding.
    expect(afterOutage.next.pendingSince).toEqual(at(18_000));
  });

  it("still fires when evaluations arrive on cadence", () => {
    let current = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 180,
      resolveAfter: 3,
      intervalSeconds: 60,
    });
    // A little jitter each tick, the way the scheduler really lands.
    for (const second of [61, 121, 184]) {
      current = advanceAlertInstance({
        previous: current.next,
        present,
        evaluatedAt: at(second),
        forSeconds: 180,
        resolveAfter: 3,
        intervalSeconds: 60,
      });
    }

    expect(current.next.status).toBe("firing");
    expect(current.event).toBe("firing");
  });

  it("resolves only after the configured absence count", () => {
    const fired = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 0,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const one = advanceAlertInstance({
      previous: fired.next,
      present: undefined,
      evaluatedAt: at(10),
      forSeconds: 0,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const two = advanceAlertInstance({
      previous: one.next,
      present: undefined,
      evaluatedAt: at(20),
      forSeconds: 0,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    expect(one.next.status).toBe("firing");
    expect(one.event).toBeNull();
    expect(two.next.status).toBe("inactive");
    expect(two.event).toBe("resolved");
  });

  it("emits a pending event on entry to pending, and only then", () => {
    const entered = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    const stillPending = advanceAlertInstance({
      previous: entered.next,
      present,
      evaluatedAt: at(30),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    expect(entered.event).toBe("pending");
    expect(stillPending.event).toBeNull();
  });

  it("does not emit a pending event when the fire is immediate", () => {
    const result = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 0,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    expect(result.event).toBe("firing");
  });

  it("clears a pending instance with a pending_cleared event, not a resolve", () => {
    const entered = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    const cleared = advanceAlertInstance({
      previous: entered.next,
      present: undefined,
      evaluatedAt: at(30),
      forSeconds: 60,
      resolveAfter: 1,
      intervalSeconds: 60,
    });
    expect(cleared.next.status).toBe("inactive");
    expect(cleared.event).toBe("pending_cleared");
  });

  it("keeps a reappearance inside the pending phase silent", () => {
    const entered = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 120,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const absent = advanceAlertInstance({
      previous: entered.next,
      present: undefined,
      evaluatedAt: at(30),
      forSeconds: 120,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    const reappeared = advanceAlertInstance({
      previous: absent.next,
      present,
      evaluatedAt: at(60),
      forSeconds: 120,
      resolveAfter: 2,
      intervalSeconds: 60,
    });
    expect(reappeared.next.status).toBe("pending");
    expect(reappeared.event).toBeNull();
  });
});
