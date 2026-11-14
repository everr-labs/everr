// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { listDefaultDestination } from "#app/data/alerting/delivery/repository.ts";
import { alertChannels, alertDefinitions, alertTrackerIssues } from "#app/db/schema/index.ts";
import { TEST_ACTOR, TEST_ORG } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";
import {
  disableErrorIssues,
  enableErrorIssues,
  getErrorIssues,
  trackedErrorIssues,
} from "./automation.server";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

const harness = registerAlertingHarness();
const scope = { organizationId: TEST_ORG, actor: TEST_ACTOR };

describe("issues for new errors", () => {
  it("starts off", async () => {
    expect(await getErrorIssues(TEST_ORG)).toMatchObject({
      enabled: false,
      environment: null,
      target: null,
      waiting: 0,
    });
  });

  it("turns on with one call, filing to GitHub without becoming the default destination", async () => {
    const state = await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "github_issues" },
    });

    expect(state).toMatchObject({
      enabled: true,
      environment: "production",
      handoff: "agent",
      target: {
        type: "github_issues",
        labels: ["everr", "everr-fix"],
        assignees: [],
        max_open: 5,
      },
      waiting: 0,
    });
    const [rule] = await harness().db.select().from(alertDefinitions);
    expect(rule).toMatchObject({ project: "everr", slug: "new-errors", active: true });
    expect(rule.spec.notifications).toEqual({ channels: ["everr-new-errors"] });
    expect(await listDefaultDestination(TEST_ORG)).toEqual({ tiers: {} });
  });

  it("moves to Linear and to another environment without a second rule", async () => {
    await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "github_issues" },
    });
    const state = await enableErrorIssues(scope, {
      environment: "prod",
      target: { type: "linear", api_key: "lin_api_secret", team: "eng" },
    });

    expect(state.environment).toBe("prod");
    expect(state.target).toMatchObject({ type: "linear", team: "ENG", api_key: "***" });
    expect(await harness().db.select().from(alertDefinitions)).toHaveLength(1);
  });

  it("keeps the saved Linear key when a change leaves it out", async () => {
    await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "linear", api_key: "lin_api_secret", team: "ENG" },
    });
    await expect(
      enableErrorIssues(scope, {
        environment: "production",
        target: { type: "linear", team: "OPS" },
      }),
    ).resolves.toMatchObject({ target: { team: "OPS" } });
  });

  it("opens issues for review without the agent's label or assignee", async () => {
    const state = await enableErrorIssues(scope, {
      environment: "production",
      handoff: "review",
      minOccurrences: 5,
      ignore: [],
      target: { type: "github_issues", assignees: ["fix-bot"] },
    });

    expect(state).toMatchObject({
      handoff: "review",
      minOccurrences: 5,
      ignore: [],
      target: { labels: ["everr"], assignees: [] },
    });
  });

  it("pauses on turn off and resumes on turn on", async () => {
    await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "github_issues" },
    });

    expect((await disableErrorIssues(scope)).enabled).toBe(false);
    const [paused] = await harness().db.select().from(alertDefinitions);
    expect(paused.active).toBe(false);

    await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "github_issues" },
    });
    const [resumed] = await harness().db.select().from(alertDefinitions);
    expect(resumed.active).toBe(true);
  });

  it("refuses an environment that could break out of the rule's query", async () => {
    await expect(
      enableErrorIssues(scope, {
        environment: "prod' OR 1=1 --",
        target: { type: "github_issues" },
      }),
    ).rejects.toThrow();
  });

  it("finds the issue each error opened", async () => {
    await enableErrorIssues(scope, {
      environment: "production",
      target: { type: "github_issues" },
    });
    const [rule] = await harness().db.select().from(alertDefinitions);
    const [channel] = await harness().db.select().from(alertChannels);
    await harness()
      .db.insert(alertTrackerIssues)
      .values({
        organizationId: TEST_ORG,
        channelId: channel.id,
        alertDefinitionId: rule.id,
        instanceFingerprint: "instance-1",
        instanceLabels: { fingerprint: "1234" },
        provider: "github",
        location: "acme/web",
        externalId: "12",
        url: "https://github.com/acme/web/issues/12",
      });

    expect(await trackedErrorIssues(TEST_ORG)).toEqual({
      "1234": {
        provider: "github",
        label: "#12",
        location: "acme/web",
        url: "https://github.com/acme/web/issues/12",
        status: "open",
      },
    });
  });
});
