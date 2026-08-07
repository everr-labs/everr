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
    });
    const second = advanceAlertInstance({
      previous: first.next,
      present,
      evaluatedAt: at(60),
      forSeconds: 60,
      resolveAfter: 1,
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
    });
    const absent = advanceAlertInstance({
      previous: first.next,
      present: undefined,
      evaluatedAt: at(30),
      forSeconds: 60,
      resolveAfter: 2,
    });
    const reappeared = advanceAlertInstance({
      previous: absent.next,
      present,
      evaluatedAt: at(60),
      forSeconds: 60,
      resolveAfter: 2,
    });
    expect(reappeared.next.status).toBe("pending");
    expect(reappeared.next.pendingSince).toEqual(at(60));
  });

  it("resolves only after the configured absence count", () => {
    const fired = advanceAlertInstance({
      previous: newInactiveInstance(present),
      present,
      evaluatedAt: at(0),
      forSeconds: 0,
      resolveAfter: 2,
    });
    const one = advanceAlertInstance({
      previous: fired.next,
      present: undefined,
      evaluatedAt: at(10),
      forSeconds: 0,
      resolveAfter: 2,
    });
    const two = advanceAlertInstance({
      previous: one.next,
      present: undefined,
      evaluatedAt: at(20),
      forSeconds: 0,
      resolveAfter: 2,
    });
    expect(one.next.status).toBe("firing");
    expect(one.event).toBeNull();
    expect(two.next.status).toBe("inactive");
    expect(two.event).toBe("resolved");
  });
});
