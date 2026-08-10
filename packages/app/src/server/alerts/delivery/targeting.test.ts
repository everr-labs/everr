import { beforeEach, describe, expect, it, vi } from "vitest";

// dispatchTargetsForEvent issues three query shapes in order: the direct
// destination lookup (from/where/limit), the route join (from/innerJoin/
// where), then one receiver lookup (from/where/limit) per matched route.
// Each queue entry answers the next query of its matching shape.
const mocks = vi.hoisted(() => ({
  limitQueue: [] as unknown[][],
  joinQueue: [] as unknown[][],
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.limitQueue.shift() ?? []),
        }),
        innerJoin: () => ({
          where: () => Promise.resolve(mocks.joinQueue.shift() ?? []),
        }),
      }),
    }),
  },
  pool: {},
}));

import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/routing/defaults";
import type { alertEvents } from "@/db/schema";
import { dispatchTargetsForEvent } from "./targeting";

function event(
  overrides: Partial<typeof alertEvents.$inferSelect> = {},
): typeof alertEvents.$inferSelect {
  return {
    id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
    organizationId: "org-1",
    sourceDefinitionId: "def-1",
    eventType: "instance_fired",
    severity: "critical",
    instanceLabels: {},
    ...overrides,
  } as unknown as typeof alertEvents.$inferSelect;
}

beforeEach(() => {
  mocks.limitQueue = [];
  mocks.joinQueue = [];
});

describe("routedDispatchTargets group_by default", () => {
  it("groups Automatic routes (group_by: null) by rule and severity", async () => {
    mocks.limitQueue = [
      [], // no direct destination: falls through to routing
      [{ id: "receiver-1" }], // receiver lookup for the matched route
    ];
    mocks.joinQueue = [
      [
        {
          route: {
            id: "route-1",
            priority: 0,
            config: { matchers: [], group_by: null },
          },
          receiver: "on-call",
        },
      ],
    ];

    const targets = await dispatchTargetsForEvent(event());

    expect(targets).toHaveLength(1);
    expect(targets[0].groupLabels).toEqual({
      rule: "def-1",
      severity: "critical",
    });
  });

  it("puts two different rules into two different groups under Automatic routing", async () => {
    mocks.limitQueue = [[], [{ id: "receiver-1" }], [], [{ id: "receiver-1" }]];
    mocks.joinQueue = [
      [
        {
          route: {
            id: "route-1",
            priority: 0,
            config: { matchers: [], group_by: null },
          },
          receiver: "on-call",
        },
      ],
      [
        {
          route: {
            id: "route-1",
            priority: 0,
            config: { matchers: [], group_by: null },
          },
          receiver: "on-call",
        },
      ],
    ];

    const [first] = await dispatchTargetsForEvent(
      event({ sourceDefinitionId: "def-1" }),
    );
    const [second] = await dispatchTargetsForEvent(
      event({ sourceDefinitionId: "def-2" }),
    );

    expect(first.groupKey).not.toBe(second.groupKey);
  });
});

describe("routedDispatchTargets timing defaults", () => {
  it("falls back to the shared default wait and interval, not a local literal", async () => {
    mocks.limitQueue = [[], [{ id: "receiver-1" }]];
    mocks.joinQueue = [
      [
        {
          route: {
            id: "route-1",
            priority: 0,
            config: {
              matchers: [],
              group_wait_secs: null,
              group_interval_secs: null,
            },
          },
          receiver: "on-call",
        },
      ],
    ];

    const [target] = await dispatchTargetsForEvent(event());

    expect(target.groupWaitSeconds).toBe(ALERTING_DEFAULT_GROUP_WAIT_SECS);
    expect(target.groupIntervalSeconds).toBe(
      ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
    );
  });
});
