// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { ALERTING_DEFAULT_GROUP_INTERVAL_SECS } from "#app/data/alerting/delivery/defaults.ts";
import { testChannel } from "#app/data/alerting/delivery/repository.ts";
import { alertDeliveries } from "#app/db/schema/index.ts";
import { insertDirectRule, TEST_ORG } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});
vi.mock("#app/lib/clickhouse-writer.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

const harness = registerAlertingHarness();
const TICK_SECS = 60;

type GraphqlRequest = { query: string; variables: Record<string, unknown> };

/** A Linear workspace with one team, ENG, answering the GraphQL the channel sends. */
function fakeLinear(opts: { users?: string[] } = {}) {
  const issues = new Map<string, string>();
  const requests: GraphqlRequest[] = [];
  harness().setFetchResponse((_url, body) => {
    const request = body as GraphqlRequest;
    requests.push(request);
    const { query, variables } = request;
    const data = (value: unknown) => ({ status: 200, body: JSON.stringify({ data: value }) });
    if (query.includes("teams(")) {
      return data({ teams: { nodes: variables.key === "ENG" ? [{ id: "team-eng" }] : [] } });
    }
    if (query.includes("issueLabelCreate")) {
      return data({ issueLabelCreate: { issueLabel: { id: `label-${String(variables.name)}` } } });
    }
    if (query.includes("issueLabels(")) return data({ issueLabels: { nodes: [] } });
    if (query.includes("users(")) {
      const found = (opts.users ?? []).includes(variables.who as string);
      return data({ users: { nodes: found ? [{ id: `user-${String(variables.who)}` }] : [] } });
    }
    if (query.includes("issueCreate")) {
      const id = `issue-${issues.size + 1}`;
      issues.set(id, "triage");
      return data({ issueCreate: { issue: { id, url: `https://linear.app/acme/issue/${id}` } } });
    }
    if (query.includes("issues(")) {
      const open = [...issues].filter(
        ([id, state]) =>
          (variables.ids as string[]).includes(id) && state !== "completed" && state !== "canceled",
      );
      return data({ issues: { nodes: open.map(([id]) => ({ id })) } });
    }
    if (query.includes("issue(id")) {
      return data({
        issue: { state: { type: issues.get(variables.id as string) }, team: { id: "team-eng" } },
      });
    }
    if (query.includes("workflowStates")) {
      return data({
        workflowStates: {
          nodes: [
            { id: "state-backlog", type: "backlog", position: 0 },
            { id: "state-todo", type: "unstarted", position: 1 },
          ],
        },
      });
    }
    if (query.includes("issueUpdate")) {
      issues.set(variables.id as string, "unstarted");
      return data({ issueUpdate: { success: true } });
    }
    return data({ commentCreate: { success: true } });
  });
  return {
    issues,
    sent: (operation: string) => requests.filter(({ query }) => query.includes(operation)),
  };
}

async function nextTick() {
  harness().advance(TICK_SECS * 1000);
  await harness().runDueJobs();
  harness().advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000);
  await harness().runDueJobs();
}

describe("an alert rule delivering to Linear", () => {
  it("files an issue in the team, labeled, and delegated to the agent it names", async () => {
    const linear = fakeLinear({ users: ["Fix Agent"] });
    await insertDirectRule(harness().db, {
      channelType: "linear",
      assignee: "Fix Agent",
      annotations: { summary: "${service} is breaching" },
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().fireAndFlush();

    const [create] = linear.sent("issueCreate");
    expect(create.variables.input).toMatchObject({
      teamId: "team-eng",
      title: "checkout is breaching",
      labelIds: ["label-everr-fix"],
      assigneeId: "user-Fix Agent",
    });
    expect(harness().fetchCalls()[0].headers.authorization).toBe("lin_api_test");
  });

  it("reopens a completed issue when the alert fires again, and leaves a canceled one alone", async () => {
    const linear = fakeLinear();
    await insertDirectRule(harness().db, { channelType: "linear", intervalSecs: TICK_SECS });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();
    harness().clickhouse.setSignal([]);
    await nextTick();
    expect(linear.sent("commentCreate")).toHaveLength(1);

    linear.issues.set("issue-1", "completed");
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await nextTick();
    expect(linear.sent("issueCreate")).toHaveLength(1);
    expect(linear.sent("issueUpdate")[0].variables).toEqual({
      id: "issue-1",
      stateId: "state-todo",
    });
    expect(linear.sent("commentCreate")).toHaveLength(2);

    harness().clickhouse.setSignal([]);
    await nextTick();
    linear.issues.set("issue-1", "canceled");
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await nextTick();
    // The resolve still comments; the fire on a canceled issue does not.
    expect(linear.sent("commentCreate")).toHaveLength(3);
    expect(linear.sent("issueUpdate")).toHaveLength(1);
  });

  it("withholds a new issue while the channel's own open issues reach its limit", async () => {
    const linear = fakeLinear();
    await insertDirectRule(harness().db, { channelType: "linear", maxOpen: 1 });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();

    harness().clickhouse.setSignal([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
    ]);
    await nextTick();

    expect(linear.sent("issueCreate")).toHaveLength(1);
    const deliveries = await harness().db.select().from(alertDeliveries);
    expect(deliveries.map((delivery) => delivery.lastError)).toContainEqual(
      expect.stringContaining("already open"),
    );
  });

  it("checks the key, the team and the assignee on a channel test without filing anything", async () => {
    const linear = fakeLinear({ users: ["Fix Agent"] });
    const config = {
      type: "linear",
      api_key: "lin_api_test",
      team: "eng",
      labels: [],
      assignee: "Fix Agent",
      max_open: 5,
    };
    expect(await testChannel(TEST_ORG, { source: { kind: "new" }, config })).toMatchObject({
      ok: true,
    });
    expect(
      await testChannel(TEST_ORG, { source: { kind: "new" }, config: { ...config, team: "OPS" } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("OPS") });
    expect(
      await testChannel(TEST_ORG, {
        source: { kind: "new" },
        config: { ...config, assignee: "nobody" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("nobody") });
    expect(linear.sent("issueCreate")).toHaveLength(0);
  });
});
