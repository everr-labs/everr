// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { ALERTING_DEFAULT_GROUP_INTERVAL_SECS } from "#app/data/alerting/delivery/defaults.ts";
import { enableErrorIssues, trackedErrorIssues } from "#app/data/error-issues/automation.server.ts";
import { githubInstallationOrganizations, serviceRepositories } from "#app/db/schema/index.ts";
import { TEST_ACTOR, TEST_ORG } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";
import { followUpErrorIssues } from "./delivery/error-issue-follow-up";

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
const INSTALLATION_ID = 42;
vi.mock("#app/server/github-events/github-api.ts", () => ({
  getRepositoryInstallationId: async () => INSTALLATION_ID,
  getInstallationToken: async () => "installation-token",
  getAppSlug: async () => "everr",
}));

const harness = registerAlertingHarness();
const RULE_INTERVAL_MS = 5 * 60 * 1000;

type FakeIssue = {
  state: "open" | "closed";
  state_reason: string | null;
  closed_at: string | null;
};

/** A private repository with the App installed, answering the calls Everr makes. */
async function fakeGithub() {
  await harness()
    .db.insert(githubInstallationOrganizations)
    .values({ githubInstallationId: INSTALLATION_ID, organizationId: TEST_ORG });
  const issues = new Map<number, FakeIssue>();
  harness().setFetchResponse((url) => {
    const path = new URL(url).pathname;
    const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return json({ private: true });
    if (path.endsWith("/issues") && url.includes("?")) return json([]);
    if (path.endsWith("/issues")) {
      const number = issues.size + 1;
      issues.set(number, { state: "open", state_reason: null, closed_at: null });
      return json({ number, html_url: `https://github.com${path}/${number}` });
    }
    const issue = /\/issues\/(\d+)$/.exec(path);
    if (issue) return json(issues.get(Number(issue[1])));
    return json({});
  });
  const calls = (match: (path: string, body: unknown) => boolean) =>
    harness()
      .fetchCalls()
      .filter(({ url, body }) => match(new URL(url).pathname, body));
  return {
    close(number: number, at = new Date()) {
      issues.set(number, {
        state: "closed",
        state_reason: "completed",
        closed_at: at.toISOString(),
      });
    },
    created: () =>
      calls((path, body) => path.endsWith("/issues") && body !== undefined).map(
        ({ body }) => body as { title: string; body: string },
      ),
    comments: () =>
      calls((path) => path.endsWith("/comments")).map(
        ({ body }) => (body as { body: string }).body,
      ),
    reopens: () => calls((path, body) => /\/issues\/\d+$/.test(path) && body !== undefined),
  };
}

/** An error log from the `web` service in production. */
function errorLog(opts: { message: string; trace: string; version?: string; at?: Date }) {
  return {
    service: "web",
    resource: {
      "deployment.environment.name": "production",
      "service.version": opts.version ?? "v1",
    },
    attributes: { "exception.type": "NotFoundError", "exception.message": opts.message },
    severity: 17,
    traceId: opts.trace,
    // The test's clock, which runs ahead of the engine's once a case advances it.
    at: opts.at ?? new Date(),
  };
}

/** The rule's next evaluation, and the delivery it leads to. */
async function evaluate() {
  harness().advance(RULE_INTERVAL_MS);
  await harness().runDueJobs();
  harness().advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000);
  await harness().runDueJobs();
}

async function turnOn() {
  // The engine reads its own clock: the test's starts from it.
  harness().setNow(new Date(vi.getRealSystemTime()));
  const github = await fakeGithub();
  await harness().db.insert(serviceRepositories).values({
    organizationId: TEST_ORG,
    serviceName: "web",
    repository: "acme/web",
  });
  await enableErrorIssues(
    { organizationId: TEST_ORG, actor: TEST_ACTOR },
    {
      environment: "production",
      target: { type: "github_issues" },
      minOccurrences: 2,
      ignore: ["ETIMEDOUT"],
    },
  );
  return github;
}

/** A new error that already has its issue, #1. */
async function openedIssue() {
  const github = await turnOn();
  harness().clickhouse.insertLogs([
    errorLog({ message: "User 4821 not found", trace: "a" }),
    errorLog({ message: "User 77 not found", trace: "b" }),
  ]);
  await evaluate();
  expect(github.created()).toHaveLength(1);
  return github;
}

describe("issues for new errors", () => {
  it("opens one issue for an error once it happened twice, named by its template", async () => {
    const github = await turnOn();
    harness().clickhouse.insertLogs([errorLog({ message: "User 4821 not found", trace: "a" })]);
    await evaluate();
    expect(github.created()).toHaveLength(0);

    // A variant of the same error, from another request.
    harness().clickhouse.insertLogs([errorLog({ message: "User 77 not found", trace: "b" })]);
    await evaluate();

    const [issue] = github.created();
    expect(github.created()).toHaveLength(1);
    expect(issue.title).toBe("NotFoundError: User <n> not found");
    expect(issue.body).not.toContain("4821");
    expect(issue.body).not.toContain("Alert rule");
  });

  it("counts a request that logged the error twice once", async () => {
    const github = await turnOn();
    harness().clickhouse.insertLogs([
      errorLog({ message: "User 1 not found", trace: "a" }),
      errorLog({ message: "User 1 not found", trace: "a" }),
    ]);
    await evaluate();

    expect(github.created()).toHaveLength(0);
  });

  it("skips the errors the list names", async () => {
    const github = await turnOn();
    harness().clickhouse.insertLogs(
      ["a", "b", "c"].map((trace) => errorLog({ message: "connect ETIMEDOUT", trace })),
    );
    await evaluate();

    expect(github.created()).toHaveLength(0);
  });

  it("does not comment or reopen when the error stops and starts again", async () => {
    const github = await openedIssue();
    github.close(1);
    harness().clickhouse.insertLogs([errorLog({ message: "User 5 not found", trace: "c" })]);
    await evaluate();
    await evaluate();

    expect(github.comments()).toEqual([]);
    expect(github.reopens()).toEqual([]);
  });
});

describe("an issue for an error, after it closes", () => {
  it("stays closed while the error happens in a build that ran before the close", async () => {
    const github = await openedIssue();
    github.close(1);
    await followUpErrorIssues();
    harness().advance(60_000);

    harness().clickhouse.insertLogs([errorLog({ message: "User 5 not found", trace: "c" })]);
    await followUpErrorIssues();

    expect(github.reopens()).toEqual([]);
    expect(github.comments()).toEqual([]);
  });

  it("reopens when the error happens in a later release", async () => {
    const github = await openedIssue();
    github.close(1);
    await followUpErrorIssues();
    harness().advance(60_000);

    harness().clickhouse.insertLogs([
      errorLog({ message: "User 5 not found", trace: "c", version: "v2" }),
    ]);
    await followUpErrorIssues();

    expect(github.reopens()).toHaveLength(1);
    expect(github.comments()).toEqual([expect.stringContaining("in version `v2`")]);
    expect(Object.values(await trackedErrorIssues(TEST_ORG))).toEqual([
      expect.objectContaining({ status: "open" }),
    ]);
  });

  it("says once that the fix held after a later release ran a day without the error", async () => {
    const github = await openedIssue();
    github.close(1);
    await followUpErrorIssues();
    harness().advance(60_000);

    // v2 starts serving, without the error.
    harness().clickhouse.insertLogs([
      {
        service: "web",
        resource: { "deployment.environment.name": "production", "service.version": "v2" },
        at: new Date(),
      },
    ]);
    await followUpErrorIssues();
    expect(github.comments()).toEqual([]);

    harness().advance(25 * 60 * 60 * 1000);
    await followUpErrorIssues();
    await followUpErrorIssues();

    expect(github.comments()).toEqual([expect.stringContaining("version `v2` has run since")]);
    expect(Object.values(await trackedErrorIssues(TEST_ORG))).toEqual([
      expect.objectContaining({ status: "fixed" }),
    ]);
  });
});
