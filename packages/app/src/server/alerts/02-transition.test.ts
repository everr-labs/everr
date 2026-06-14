import { describe, expect, it } from "vitest";
import {
  type AlertInstance,
  diffInstances,
  type FiringInstance,
} from "./02-instances";
import { buildAlertTransition } from "./02-transition";

const now = new Date("2026-06-10T12:00:00.000Z");
const earlier = new Date("2026-06-10T11:55:00.000Z");

function currentInstance(route: string): AlertInstance {
  return {
    fingerprint: route,
    labels: { route },
    firedAt: now,
    row: { route },
  };
}

function previousInstance(route: string): FiringInstance {
  return {
    fingerprint: route,
    labels: { route },
    firedAt: earlier,
  };
}

function transition(previous: FiringInstance[], current: AlertInstance[]) {
  return buildAlertTransition({
    previous,
    current,
    diff: diffInstances(previous, current),
    now,
  });
}

describe("buildAlertTransition", () => {
  it("keeps a resolved alert resolved without actions", () => {
    const result = transition([], []);

    expect(result).toMatchObject({
      name: "stayed_resolved",
      nextState: "resolved",
      firingCount: 0,
      definitionUpdate: {
        currentState: "resolved",
        firingInstanceCount: 0,
      },
      actions: [],
    });
    expect(result.definitionUpdate).not.toHaveProperty("lastSeenAt");
    expect(result.definitionUpdate).not.toHaveProperty("lastFiredAt");
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });

  it("starts firing from resolved state", () => {
    const result = transition([], [currentInstance("/x")]);

    expect(result).toMatchObject({
      name: "started_firing",
      nextState: "firing",
      firingCount: 1,
      definitionUpdate: {
        currentState: "firing",
        firingInstanceCount: 1,
        lastSeenAt: now,
        lastFiredAt: now,
      },
      actions: [{ kind: "firing" }],
    });
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });

  it("keeps a firing alert firing without actions when the set is unchanged", () => {
    const result = transition(
      [previousInstance("/x")],
      [currentInstance("/x")],
    );

    expect(result).toMatchObject({
      name: "stayed_firing",
      nextState: "firing",
      firingCount: 1,
      definitionUpdate: {
        currentState: "firing",
        firingInstanceCount: 1,
        lastSeenAt: now,
      },
      actions: [],
    });
    expect(result.definitionUpdate).not.toHaveProperty("lastFiredAt");
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });

  it("fires added instances while already firing", () => {
    const result = transition(
      [previousInstance("/x")],
      [currentInstance("/x"), currentInstance("/y")],
    );

    expect(result).toMatchObject({
      name: "added_firing_instances",
      nextState: "firing",
      firingCount: 2,
      definitionUpdate: {
        currentState: "firing",
        firingInstanceCount: 2,
        lastSeenAt: now,
      },
      actions: [{ kind: "firing" }],
    });
    expect(result.actions[0]?.instances).toEqual([currentInstance("/y")]);
    expect(result.definitionUpdate).not.toHaveProperty("lastFiredAt");
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });

  it("partially resolves while staying in firing state", () => {
    const result = transition(
      [previousInstance("/x"), previousInstance("/y")],
      [currentInstance("/x")],
    );

    expect(result).toMatchObject({
      name: "partially_resolved",
      nextState: "firing",
      firingCount: 1,
      definitionUpdate: {
        currentState: "firing",
        firingInstanceCount: 1,
        lastSeenAt: now,
      },
      actions: [{ kind: "partial_resolved" }],
    });
    expect(result.actions[0]?.instances).toEqual([previousInstance("/y")]);
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });

  it("fully resolves a firing alert", () => {
    const result = transition([previousInstance("/x")], []);

    expect(result).toMatchObject({
      name: "resolved",
      nextState: "resolved",
      firingCount: 0,
      definitionUpdate: {
        currentState: "resolved",
        firingInstanceCount: 0,
        lastResolvedAt: now,
      },
      actions: [{ kind: "resolved" }],
    });
    expect(result.actions[0]?.instances).toEqual([previousInstance("/x")]);
    expect(result.definitionUpdate).not.toHaveProperty("lastSeenAt");
  });

  it("emits firing before partial resolve when instances churn", () => {
    const result = transition(
      [previousInstance("/x")],
      [currentInstance("/y")],
    );

    expect(result).toMatchObject({
      name: "churned",
      nextState: "firing",
      firingCount: 1,
      definitionUpdate: {
        currentState: "firing",
        firingInstanceCount: 1,
        lastSeenAt: now,
      },
      actions: [{ kind: "firing" }, { kind: "partial_resolved" }],
    });
    expect(result.actions[0]?.instances).toEqual([currentInstance("/y")]);
    expect(result.actions[1]?.instances).toEqual([previousInstance("/x")]);
    expect(result.definitionUpdate).not.toHaveProperty("lastFiredAt");
    expect(result.definitionUpdate).not.toHaveProperty("lastResolvedAt");
  });
});
