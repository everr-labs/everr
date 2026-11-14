// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "#app/data/alerting/delivery/config.ts";
import { ALERTING_DEFAULT_GROUP_INTERVAL_SECS } from "#app/data/alerting/delivery/defaults.ts";
import { testChannel } from "#app/data/alerting/delivery/repository.ts";
import { ANN_ISSUES_KIND } from "#app/data/alerting/resource-annotations.ts";
import {
  heldIssueCounts,
  releaseCapacityHolds,
} from "#app/data/alerting/delivery/held-issues.server.ts";
import { setServiceRepository } from "#app/data/service-repositories/links.server.ts";
import {
  alertDeliveries,
  githubInstallationOrganizations,
  serviceRepositories,
  workflowRuns,
} from "#app/db/schema/index.ts";
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

// The App's own authentication (a signed JWT, an installation token) is
// GitHub's business. The REST calls that file and update issues go through
// the harness's fetch stub.
const INSTALLATION_ID = 42;
vi.mock("#app/server/github-events/github-api.ts", () => ({
  getRepositoryInstallationId: async () => INSTALLATION_ID,
  getInstallationToken: async () => "installation-token",
  getAppSlug: async () => "everr",
}));

const harness = registerAlertingHarness();
const TICK_SECS = 60;

type FakeIssue = { state: "open" | "closed"; state_reason: string | null };

/** A GitHub that answers like the real one for the calls the channel makes. */
function fakeGithub(opts: { private?: boolean; openIssues?: number } = {}) {
  const issues = new Map<number, FakeIssue>();
  let openIssues = opts.openIssues ?? 0;
  harness().setFetchResponse((url) => {
    const path = new URL(url).pathname;
    const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return json({ private: opts.private ?? true });
    if (path.endsWith("/issues") && url.includes("?")) {
      return json(Array.from({ length: openIssues }, (_, i) => ({ number: 900 + i })));
    }
    if (path.endsWith("/issues")) {
      const number = issues.size + 1;
      issues.set(number, { state: "open", state_reason: null });
      return json({ number, html_url: `https://github.com${path}/${number}` });
    }
    const issue = /\/issues\/(\d+)$/.exec(path);
    if (issue) return json(issues.get(Number(issue[1])));
    return json({});
  });
  return {
    issues,
    /** How many Everr issues GitHub reports open, besides those it filed. */
    setOpenIssues(count: number) {
      openIssues = count;
    },
    calls(method: "create" | "comment" | "reopen") {
      return harness()
        .fetchCalls()
        .filter(({ url, body }) => {
          const path = new URL(url).pathname;
          if (method === "create") return path.endsWith("/issues") && !url.includes("?") && body;
          if (method === "comment") return path.endsWith("/comments");
          return /\/issues\/\d+$/.test(path) && body !== undefined;
        });
    },
  };
}

/** CI Everr saw, one run per repository. */
async function sawCi(...runs: { repository: string; sha?: string }[]) {
  await harness()
    .db.insert(workflowRuns)
    .values(
      runs.map((run, i) => ({
        organizationId: TEST_ORG,
        runId: i + 1,
        traceId: `trace-${i + 1}`,
        workflowName: "ci",
        repository: run.repository,
        sha: run.sha ?? `${i + 1}`.padStart(40, "0"),
        ref: "refs/heads/main",
        status: "completed" as const,
        lastEventAt: new Date(),
      })),
    );
}

async function installGithubApp() {
  await harness()
    .db.insert(githubInstallationOrganizations)
    .values({ githubInstallationId: INSTALLATION_ID, organizationId: TEST_ORG });
}

/** One more evaluation, then long enough for the already-flushed group to
 *  flush again. */
async function nextTick() {
  harness().advance(TICK_SECS * 1000);
  await harness().runDueJobs();
  harness().advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000);
  await harness().runDueJobs();
}

describe("an alert rule delivering to GitHub Issues", () => {
  it("opens one issue per firing instance, in the repository the rule was applied from", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repoid: "github.com/acme/api",
      annotations: { summary: "${service} is breaching" },
    });
    harness().clickhouse.setSignal([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
    ]);

    await harness().fireAndFlush();

    const created = github.calls("create");
    expect(created.map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/api/issues",
      "/repos/acme/api/issues",
    ]);
    const titles = created.map(({ body }) => (body as { title: string }).title).sort();
    expect(titles).toEqual(["checkout is breaching", "payments is breaching"]);
    expect(created[0].body).toMatchObject({ labels: ["everr-fix"] });
  });

  it("keeps one issue across a resolve and a recurrence, reopening it when it was closed as done", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repo: "acme/api",
      intervalSecs: TICK_SECS,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();
    expect(github.calls("create")).toHaveLength(1);

    harness().clickhouse.setSignal([]);
    await nextTick();
    expect(github.calls("comment")).toHaveLength(1);
    expect(JSON.stringify(github.calls("comment")[0].body)).toContain("Stopped firing");

    github.issues.set(1, { state: "closed", state_reason: "completed" });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await nextTick();

    expect(github.calls("create")).toHaveLength(1);
    expect(github.calls("reopen")).toHaveLength(1);
    expect(github.calls("comment")).toHaveLength(2);
    expect(JSON.stringify(github.calls("comment")[1].body)).toContain("Fired again");
  });

  it("only opens the issue for a rule about errors, and leaves the rest to the follow-up", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repo: "acme/api",
      intervalSecs: TICK_SECS,
      annotations: { [ANN_ISSUES_KIND]: "error" },
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();

    harness().clickhouse.setSignal([]);
    await nextTick();
    github.issues.set(1, { state: "closed", state_reason: "completed" });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await nextTick();

    expect(github.calls("create")).toHaveLength(1);
    expect(github.calls("reopen")).toHaveLength(0);
    expect(github.calls("comment")).toHaveLength(0);
  });

  it("leaves an issue closed as not planned alone when the alert fires again", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repo: "acme/api",
      intervalSecs: TICK_SECS,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();
    harness().clickhouse.setSignal([]);
    await nextTick();

    github.issues.set(1, { state: "closed", state_reason: "not_planned" });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await nextTick();

    expect(github.calls("create")).toHaveLength(1);
    expect(github.calls("reopen")).toHaveLength(0);
    // Only the resolve's comment, from before the issue was closed.
    expect(github.calls("comment")).toHaveLength(1);
  });

  it("refuses a public repository and records why", async () => {
    await installGithubApp();
    const github = fakeGithub({ private: false });
    await insertDirectRule(harness().db, { channelType: "github_issues", repo: "acme/oss" });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create")).toHaveLength(0);
    const [delivery] = await harness().db.select().from(alertDeliveries);
    expect(delivery).toMatchObject({ status: "failed", attempts: ALERT_DELIVERY_MAX_ATTEMPTS });
    expect(delivery.lastError).toContain("public");
  });

  it("sends nothing when an alert that never got an issue stops firing", async () => {
    await installGithubApp();
    fakeGithub({ private: false });
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repo: "acme/oss",
      intervalSecs: TICK_SECS,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();

    harness().clickhouse.setSignal([]);
    await nextTick();

    // Only the fire's failed delivery: the resolve had no issue to comment on.
    const deliveries = await harness().db.select().from(alertDeliveries);
    expect(deliveries.map(({ status }) => status)).toEqual(["failed"]);
    const terminal = harness()
      .clickhouse.historyRows()
      .find((row) => row.event_type === "notification_suppressed");
    expect(terminal?.reason).toBe("no_issue");
  });

  it("keeps new issues waiting while the limit of open issues is reached, then opens the most frequent first", async () => {
    await installGithubApp();
    const github = fakeGithub({ openIssues: 2 });
    await insertDirectRule(harness().db, {
      channelType: "github_issues",
      repo: "acme/api",
      maxOpen: 2,
      annotations: { summary: "${service} is breaching" },
    });
    harness().clickhouse.setSignal([
      { service: "checkout", value: 5 },
      { service: "payments", value: 50 },
    ]);

    await harness().fireAndFlush();

    expect(github.calls("create")).toHaveLength(0);
    const deliveries = await harness().db.select().from(alertDeliveries);
    expect(deliveries.map((delivery) => delivery.lastError)).toEqual([
      expect.stringContaining("It opens when one closes"),
      expect.stringContaining("It opens when one closes"),
    ]);

    const titles = () =>
      github.calls("create").map(({ body }) => (body as { title: string }).title);
    // Still full: trying again opens nothing and keeps both waiting.
    await releaseCapacityHolds();
    await harness().runDueJobs();
    expect(titles()).toEqual([]);

    github.setOpenIssues(1);
    await releaseCapacityHolds();
    await harness().runDueJobs();
    expect(titles()).toEqual(["payments is breaching"]);

    await releaseCapacityHolds();
    await harness().runDueJobs();
    expect(titles()).toEqual(["payments is breaching", "checkout is breaching"]);
  });

  it("does not write to a repository another organization's installation reaches", async () => {
    await harness()
      .db.insert(githubInstallationOrganizations)
      .values({ githubInstallationId: INSTALLATION_ID, organizationId: "org_other" });
    const github = fakeGithub();
    await insertDirectRule(harness().db, { channelType: "github_issues", repo: "other/api" });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create")).toHaveLength(0);
    const [delivery] = await harness().db.select().from(alertDeliveries);
    expect(delivery.status).toBe("failed");
  });

  it("checks access on a channel test without opening an issue", async () => {
    await installGithubApp();
    const config = {
      type: "github_issues",
      repo: "acme/api",
      labels: ["everr-fix"],
      assignees: [],
      max_open: 5,
    };
    const github = fakeGithub();
    expect(await testChannel(TEST_ORG, { source: { kind: "new" }, config })).toMatchObject({
      ok: true,
    });
    fakeGithub({ private: false });
    expect(await testChannel(TEST_ORG, { source: { kind: "new" }, config })).toMatchObject({
      ok: false,
      error: expect.stringContaining("public"),
    });
    expect(github.calls("create")).toHaveLength(0);
  });

  it("files an error in the repository its service reports, over the channel's own", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await insertDirectRule(harness().db, { channelType: "github_issues", repo: "acme/api" });
    harness().clickhouse.setSignal([
      { service: "web", value: 42, repository_url: "https://github.com/acme/web.git" },
    ]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/web/issues",
    ]);
  });

  it("finds the repository from the commit in service.version, through the CI runs Everr saw", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi(
      { repository: "acme/worker", sha: "abc1234def5678abc1234def5678abc1234def56" },
      { repository: "acme/api" },
    );
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([{ service: "worker", value: 42, service_version: "abc1234" }]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/worker/issues",
    ]);
  });

  it("reads a bare vcs.repository.name against the repositories Everr saw in CI", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi({ repository: "acme/web" }, { repository: "acme/api" });
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([{ service: "web", value: 42, repository_name: "web" }]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/web/issues",
    ]);
  });

  it("reads the service's own logs when the alert does not carry its repository", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi({ repository: "acme/web" }, { repository: "acme/api" });
    harness().clickhouse.insertLogs([
      { service: "web", resource: { "vcs.repository.url.full": "https://github.com/acme/web" } },
    ]);
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([{ service: "web", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/web/issues",
    ]);
  });

  it("files to the repository someone linked the service to, over what the service reports", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await harness().db.insert(serviceRepositories).values({
      organizationId: TEST_ORG,
      serviceName: "web",
      repository: "acme/storefront",
    });
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([
      { service: "web", value: 42, repository_url: "https://github.com/acme/web" },
    ]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/storefront/issues",
    ]);
  });

  it("prefers the channel's repository to guessing the organization's only one", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi({ repository: "acme/solo" });
    await insertDirectRule(harness().db, { channelType: "github_issues", repo: "acme/api" });
    harness().clickhouse.setSignal([{ service: "web", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/api/issues",
    ]);
  });

  it("falls back to the organization's only repository", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi({ repository: "acme/solo" });
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([{ service: "web", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/solo/issues",
    ]);
  });

  it("holds an issue for a service with no repository, and opens it once someone links the service", async () => {
    await installGithubApp();
    const github = fakeGithub();
    await sawCi({ repository: "acme/web" }, { repository: "acme/api" });
    await insertDirectRule(harness().db, { channelType: "github_issues" });
    harness().clickhouse.setSignal([{ service: "web", value: 42 }]);

    await harness().fireAndFlush();

    expect(github.calls("create")).toHaveLength(0);
    const [held] = await harness().db.select().from(alertDeliveries);
    expect(held.lastError).toContain("waiting for a repository");
    expect(await heldIssueCounts(TEST_ORG)).toEqual(new Map([["web", 1]]));

    expect(await setServiceRepository(TEST_ORG, "user-1", "web", "acme/web")).toEqual({ sent: 1 });
    await harness().runDueJobs();

    expect(github.calls("create").map(({ url }) => new URL(url).pathname)).toEqual([
      "/repos/acme/web/issues",
    ]);
    const [sent] = await harness().db.select().from(alertDeliveries);
    expect(sent.status).toBe("sent");
    // Nothing left waiting: linking again sends nothing more.
    expect(await setServiceRepository(TEST_ORG, "user-1", "web", "acme/web")).toEqual({ sent: 0 });
  });
});
