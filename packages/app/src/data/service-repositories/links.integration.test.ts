// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { githubInstallationOrganizations, workflowRuns } from "#app/db/schema/index.ts";
import { TEST_ORG } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";
import { serviceRepositoryLinks, setServiceRepository } from "./links.server";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

// What the App installation can reach, as GitHub lists it.
vi.mock("#app/server/github-events/backfill.ts", () => ({
  listInstallationRepos: async () => [
    { id: 1, full_name: "acme/docs", html_url: "https://github.com/acme/docs" },
    { id: 2, full_name: "acme/checkout", html_url: "https://github.com/acme/checkout" },
  ],
}));

const harness = registerAlertingHarness();

async function sawCi(...runs: { repository: string; sha: string }[]) {
  await harness()
    .db.insert(workflowRuns)
    .values(
      runs.map((run, i) => ({
        organizationId: TEST_ORG,
        runId: i + 1,
        traceId: `trace-${i + 1}`,
        workflowName: "ci",
        repository: run.repository,
        sha: run.sha,
        ref: "refs/heads/main",
        status: "completed" as const,
        lastEventAt: new Date(),
      })),
    );
}

describe("service repositories", () => {
  it("works out each service's repository from its telemetry and the CI Everr saw", async () => {
    await sawCi(
      { repository: "acme/checkout", sha: "1".repeat(40) },
      { repository: "acme/payments", sha: `deadbee${"0".repeat(33)}` },
    );
    const production = { "deployment.environment.name": "production" };
    harness().clickhouse.insertLogs([
      {
        service: "checkout",
        resource: { ...production, "vcs.repository.url.full": "git@github.com:acme/checkout.git" },
      },
      { service: "payments", resource: { ...production, "service.version": "deadbee" } },
      { service: "legacy", resource: { "deployment.environment": "production" } },
      { service: "preview", resource: { "deployment.environment.name": "staging" } },
    ]);

    const { links, repositories } = await serviceRepositoryLinks(TEST_ORG, "production");

    expect(links).toEqual([
      { service: "checkout", repository: "acme/checkout", source: "attribute", held: 0 },
      { service: "legacy", repository: null, source: null, held: 0 },
      { service: "payments", repository: "acme/payments", source: "commit", held: 0 },
    ]);
    expect(repositories.sort()).toEqual(["acme/checkout", "acme/payments"]);
  });

  it("keeps a repository picked by hand over what Everr works out, until it is reset", async () => {
    harness().clickhouse.insertLogs([
      { service: "web", resource: { "vcs.repository.url.full": "https://github.com/acme/web" } },
    ]);

    await setServiceRepository(TEST_ORG, "user-1", "web", "acme/storefront");
    expect((await serviceRepositoryLinks(TEST_ORG)).links).toEqual([
      { service: "web", repository: "acme/storefront", source: "set", held: 0 },
    ]);

    await setServiceRepository(TEST_ORG, "user-1", "web", null);
    expect((await serviceRepositoryLinks(TEST_ORG)).links).toEqual([
      { service: "web", repository: "acme/web", source: "attribute", held: 0 },
    ]);
  });

  it("offers the repositories the GitHub App reaches besides those seen in CI, without guessing from them", async () => {
    await harness()
      .db.insert(githubInstallationOrganizations)
      .values({ githubInstallationId: 42, organizationId: TEST_ORG });
    await sawCi({ repository: "acme/checkout", sha: "1".repeat(40) });
    harness().clickhouse.insertLogs([{ service: "docs", resource: {} }]);

    const { links, repositories } = await serviceRepositoryLinks(TEST_ORG);

    expect(repositories).toEqual(["acme/checkout", "acme/docs"]);
    // The one repository with CI is still the only one inference trusts.
    expect(links).toEqual([
      { service: "docs", repository: "acme/checkout", source: "only_repository", held: 0 },
    ]);
  });
});
