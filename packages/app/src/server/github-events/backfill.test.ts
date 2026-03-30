import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_PRIVATE_KEY = vi.hoisted(
  () => `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAwQE9gr3Si6qEjs54XuPHL7Up5zFgc2dX++/8AVbNa1Qhyruz
ETIJDH14ZufrWGQyNHrNIIifYFEbmd8ntP3W0q9iKBe45Pjuho9rR7+QCJwPDWiP
Rc8L9IkAIcGDyUlMpWZTdxtgES6kBoTuJtVq9ePdkxL8FaMLHAgvcGraQPn/5isK
UBwzXsqf6gM4SGV0gMh49oT90YoNF3rHO6A03xIzwrQMNB2/SnJYJUePd9aGU1qC
o5VF9giHB0aqS0NC5pdmbTD8++PHl4bbEv5WNF0e+amKlQ8+EBmWMpNgumU9PAf9
y4Vh7FiLh6hWN9IEjmf5hUPGs+TgKBkGmMLnrwIDAQABAoIBAFZ7bcqFsDAxChDL
Z5htTDWOYeZcc7GCXyRe1nbrJESxgCrNjGFqIC/ekPLbfNMwomZtmDi5v2BzN4Dt
Q2eQTpA9UihQ6OKAwLC+1v1hUvLoqr4BWiGXsu2x7cMyaRDqrVN31HKMa7GHSqw5
KFVyT+k6X3ClkxtG4ZV//XHMD1wJYm87z5HaFfZUQof4ywjHQCyn/nunk9Nqe2I4
XF4QZZNEi2+A/hDhdRWfWybv4+1Xu6847oydbK2v4luO5EdI212jZfWH3DkovdXt
0ycdw3TOsrhG28Skj5hw4fZAa/U3z5zUyEkkRfq1/1UwNBTSaVTLnLDFaDrTjimN
yMAtZKECgYEA4OSmd+tKQYCk/2UMdFVt9IRrqoNEBIySazMdWBUpWZpyXQg2IVuH
apAJAcJ//NE9/oiDih1m7f4fWT3OlAhyZUOJmjEctXVyymDOBYIwkythBCXIJS84
SkWagPrmRcJfJtxLVztVrSxVuJrx1F2ueityUllRIinqKmCJzJCupekCgYEA27Nw
80il3tMyHtoxVrRNbex+viJNTgw7EIMG4Y5NHrXG/fCN8aoOmUqGwt1bXOeqq+Rk
7frW9wT3AShtZpDPjW5XQWh4ezGp0aerc7qa7vd2DNqG49MD/DQUUvZ7n2RMRiQA
L0FbdV1hdh/jmdEEFhVvTWmLl6cCvTJ9VekhadcCgYA4eRJYYKxH4I8OVwiWmfE/
ipUiv02wOsB1zOMcgEve5Uq8k9hL7hkGKF8qovXSvZRsu0kUwKddMggbN8sNH0Xi
qd/+6UBFTNXjfgWeGoAqJKV7DiXBOKdQ90OCCf8TG2kbcAw3Pn4YO17XOYlqg4/R
u+E8TpNyGcZkl9NinB5PKQKBgQDSCvwxm4L5RXDljjUdb8OXFEMYBDNkKs1NO/eY
LTQN6DwXC6SpJqxOYbH1Gyv95n6FWBYmb2qVP2nm8X+mT0wfKx7AqeCF5zUz+9kv
C3iUfoGeSE4uAdANjrzflEccXAeQB1sl0pZd3qkPBe3TYMFHW7bNi9qpYkJ8H4k0
WW5YgQKBgQDQR6qsHihmUJtf0IQmeMZgqHKA/w4i5GPdXcE6XRKd3gZ4Z2fz5eGQ
XYsrykjDVpgT91jOTo2OL9zKXEqIBEXobCvgh22thyuE3PCl4MC9Xc9PB0YBQdGU
Fsrc1q1fTle7lSONUeU6x3dmVrEfPkOy0qsD4gI8/CjoY5qib+yZLw==
-----END RSA PRIVATE KEY-----`,
);

vi.mock("@/env/github", () => ({
  githubEnv: {
    GITHUB_APP_ID: 12345,
    GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
    GITHUB_APP_WEBHOOK_SECRET: "test-webhook-secret-for-signing",
  },
}));

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("./runtime", () => ({
  enqueueWebhookEvent: (...args: unknown[]) => mockEnqueue(...args),
}));

const mockDbSelect = vi.fn();
vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));
vi.mock("@/db/schema", () => ({
  workflowRuns: { traceId: "trace_id", tenantId: "tenant_id" },
}));

import {
  type ApiRepo,
  apiJobToCollectorBody,
  apiRunToCollectorBody,
  backfillRepo,
} from "./backfill";
import { generateWorkflowTraceId } from "./trace-id";

const TEST_REPO: ApiRepo = {
  id: 1,
  full_name: "acme/repo",
  html_url: "https://github.com/acme/repo",
};

const TEST_USER = {
  login: "dev",
  id: 1,
  node_id: "U_1",
  avatar_url: "https://avatars.githubusercontent.com/u/1",
  gravatar_id: "",
  url: "https://api.github.com/users/dev",
  html_url: "https://github.com/dev",
  followers_url: "https://api.github.com/users/dev/followers",
  following_url: "https://api.github.com/users/dev/following{/other_user}",
  gists_url: "https://api.github.com/users/dev/gists{/gist_id}",
  starred_url: "https://api.github.com/users/dev/starred{/owner}{/repo}",
  subscriptions_url: "https://api.github.com/users/dev/subscriptions",
  organizations_url: "https://api.github.com/users/dev/orgs",
  repos_url: "https://api.github.com/users/dev/repos",
  events_url: "https://api.github.com/users/dev/events{/privacy}",
  received_events_url: "https://api.github.com/users/dev/received_events",
  type: "User",
  site_admin: false,
};

const TEST_MINIMAL_REPO = {
  id: 1,
  node_id: "R_1",
  name: "repo",
  full_name: "acme/repo",
  private: false,
  owner: TEST_USER,
  html_url: "https://github.com/acme/repo",
  description: null,
  fork: false,
  url: "https://api.github.com/repos/acme/repo",
};

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    node_id: "WFR_1001",
    name: "CI",
    head_branch: "main",
    head_sha: "abc123",
    path: ".github/workflows/ci.yml",
    display_title: "CI #42",
    run_number: 42,
    run_attempt: 1,
    event: "push",
    status: "completed",
    conclusion: "success",
    workflow_id: 100,
    check_suite_id: 5001,
    check_suite_node_id: "CS_5001",
    url: "https://api.github.com/repos/acme/repo/actions/runs/1001",
    html_url: "https://github.com/acme/repo/actions/runs/1001",
    jobs_url: "https://api.github.com/repos/acme/repo/actions/runs/1001/jobs",
    logs_url: "https://api.github.com/repos/acme/repo/actions/runs/1001/logs",
    check_suite_url: "https://api.github.com/repos/acme/repo/check-suites/5001",
    artifacts_url:
      "https://api.github.com/repos/acme/repo/actions/runs/1001/artifacts",
    cancel_url:
      "https://api.github.com/repos/acme/repo/actions/runs/1001/cancel",
    rerun_url: "https://api.github.com/repos/acme/repo/actions/runs/1001/rerun",
    workflow_url:
      "https://api.github.com/repos/acme/repo/actions/workflows/100",
    previous_attempt_url: null,
    pull_requests: [],
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:05:00Z",
    run_started_at: "2026-03-01T00:00:00Z",
    actor: TEST_USER,
    triggering_actor: TEST_USER,
    head_commit: {
      id: "abc123",
      tree_id: "tree123",
      message: "test commit",
      timestamp: "2026-03-01T00:00:00Z",
      author: { email: "dev@example.com", name: "Dev" },
      committer: { email: "dev@example.com", name: "Dev" },
    },
    repository: TEST_MINIMAL_REPO,
    head_repository: TEST_MINIMAL_REPO,
    referenced_workflows: [],
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 2001,
    run_id: 1001,
    run_url: "https://api.github.com/repos/acme/repo/actions/runs/1001",
    run_attempt: 1,
    node_id: "CR_2001",
    head_sha: "abc123",
    head_branch: "main",
    url: "https://api.github.com/repos/acme/repo/actions/jobs/2001",
    html_url: "https://github.com/acme/repo/actions/runs/1001/job/2001",
    status: "completed",
    conclusion: "success",
    created_at: "2026-03-01T00:00:00Z",
    started_at: "2026-03-01T00:00:10Z",
    completed_at: "2026-03-01T00:03:00Z",
    name: "build",
    steps: [
      {
        name: "Set up job",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: "2026-03-01T00:00:10Z",
        completed_at: "2026-03-01T00:00:12Z",
      },
    ],
    check_run_url: "https://api.github.com/repos/acme/repo/check-runs/2001",
    labels: ["ubuntu-latest"],
    runner_id: 1,
    runner_name: "runner-1",
    runner_group_id: 1,
    runner_group_name: "Default",
    workflow_name: "CI",
    ...overrides,
  };
}

function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      token: "ghs_test",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  };
}

function mockGitHubList(itemsKey: string, items: unknown[], linkNext?: string) {
  const headers = new Headers();
  if (linkNext) {
    headers.set("link", `<${linkNext}>; rel="next"`);
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ [itemsKey]: items }),
    headers,
  };
}

function setupDbMock(existingTraceIds: string[] = []) {
  const rows = existingTraceIds.map((traceId) => ({ traceId }));
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  mockDbSelect.mockReturnValue({ from });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue(undefined);
  setupDbMock([]);
});

// ---------------------------------------------------------------------------
// Payload transformation
// ---------------------------------------------------------------------------

describe("apiRunToCollectorBody", () => {
  it("injects status and wraps run in webhook envelope", () => {
    const run = makeRun();
    const buf = apiRunToCollectorBody(run, TEST_REPO, 555);
    const parsed = JSON.parse(buf.toString("utf8"));

    expect(parsed.action).toBe("completed");
    expect(parsed.installation.id).toBe(555);
    expect(parsed.repository.full_name).toBe("acme/repo");
    expect(parsed.workflow_run.id).toBe(1001);
    expect(parsed.workflow_run.status).toBe("completed");
    expect(parsed.workflow_run.conclusion).toBe("success");
  });
});

describe("apiJobToCollectorBody", () => {
  it("uses 'labels' field (not runner_labels) and injects status", () => {
    const job = makeJob();
    const buf = apiJobToCollectorBody(job, TEST_REPO, 555);
    const parsed = JSON.parse(buf.toString("utf8"));

    expect(parsed.action).toBe("completed");
    expect(parsed.workflow_job.status).toBe("completed");
    expect(parsed.workflow_job.labels).toEqual(["ubuntu-latest"]);
    expect(parsed.workflow_job.runner_labels).toEqual(["ubuntu-latest"]);
  });
});

// ---------------------------------------------------------------------------
// backfillRepo
// ---------------------------------------------------------------------------

describe("backfillRepo", () => {
  function setupFetch(
    runs: ReturnType<typeof makeRun>[],
    jobsPerRun: ReturnType<typeof makeJob>[][],
  ) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/access_tokens")) {
        return mockTokenResponse();
      }
      if (url.includes("/actions/runs?") && url.includes("branch=main")) {
        return mockGitHubList("workflow_runs", runs);
      }
      if (url.includes("/actions/runs?")) {
        // master/develop — empty
        return mockGitHubList("workflow_runs", []);
      }
      if (url.includes("/jobs")) {
        const runId = Number(url.match(/runs\/(\d+)\/jobs/)?.[1]);
        const idx = runs.findIndex((r) => r.id === runId);
        return mockGitHubList("jobs", idx >= 0 ? jobsPerRun[idx] : []);
      }
      return mockGitHubList("workflow_runs", []);
    });
  }

  it("replays runs and jobs through the collector", async () => {
    const runs = [makeRun({ id: 1 })];
    const jobs = [[makeJob({ id: 101, run_id: 1 })]];
    setupFetch(runs, jobs);

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.runsReplayed).toBe(1);
    expect(result.jobsReplayed).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(2); // 1 run + 1 job
  });

  it("filters out cancelled conclusions", async () => {
    const runs = [
      makeRun({ id: 1, conclusion: "cancelled" }),
      makeRun({ id: 2, conclusion: "success" }),
    ];
    const jobs = [
      [], // shouldn't be reached
      [makeJob({ id: 201, run_id: 2 })],
    ];
    setupFetch(runs, jobs);

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.runsReplayed).toBe(1);
    expect(result.jobsReplayed).toBe(1);
  });

  it("stops after 100 jobs per repo", async () => {
    // 25 runs with 5 jobs each = 125 jobs, should stop at 100 (20 runs)
    const runs = Array.from({ length: 25 }, (_, i) =>
      makeRun({ id: i + 1, run_number: i + 1 }),
    );
    const jobsPerRun = runs.map((r) =>
      Array.from({ length: 5 }, (_, j) =>
        makeJob({ id: r.id * 100 + j, run_id: r.id }),
      ),
    );
    setupFetch(runs, jobsPerRun);

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.jobsReplayed).toBe(100);
    expect(result.runsReplayed).toBe(20);
  });

  it("skips master/develop if quota filled on main", async () => {
    // 25 runs with 5 jobs = 125, quota hit at 100 on main
    const runs = Array.from({ length: 25 }, (_, i) =>
      makeRun({ id: i + 1, run_number: i + 1 }),
    );
    const jobsPerRun = runs.map((r) =>
      Array.from({ length: 5 }, (_, j) =>
        makeJob({ id: r.id * 100 + j, run_id: r.id }),
      ),
    );
    setupFetch(runs, jobsPerRun);

    await backfillRepo(999, 1, TEST_REPO);

    // Should not have fetched master or develop branches
    const fetchedUrls = mockFetch.mock.calls.map((c) => c[0] as string);
    const branchUrls = fetchedUrls.filter((u) => u.includes("/actions/runs?"));
    expect(branchUrls.some((u) => u.includes("branch=master"))).toBe(false);
    expect(branchUrls.some((u) => u.includes("branch=develop"))).toBe(false);
  });

  it("handles repos with no workflow runs", async () => {
    setupFetch([], []);

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.runsReplayed).toBe(0);
    expect(result.jobsReplayed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("continues with remaining runs when one run fails", async () => {
    const runs = [
      makeRun({ id: 1, conclusion: "success" }),
      makeRun({ id: 2, conclusion: "success" }),
    ];
    const jobs = [
      [makeJob({ id: 101, run_id: 1 })],
      [makeJob({ id: 201, run_id: 2 })],
    ];
    setupFetch(runs, jobs);

    // Make replay fail for run 1's job (jobs are enqueued before runs)
    mockEnqueue
      .mockRejectedValueOnce(new Error("collector down")) // run 1's job fails
      .mockResolvedValue(undefined); // rest OK

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.runsReplayed).toBe(2);
    expect(result.jobsReplayed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("collector down");
  });

  it("skips runs whose traceId already exists in the database", async () => {
    const runs = [
      makeRun({ id: 1, conclusion: "success" }),
      makeRun({ id: 2, conclusion: "success" }),
      makeRun({ id: 3, conclusion: "success" }),
    ];
    const jobs = [
      [makeJob({ id: 101, run_id: 1 })],
      [makeJob({ id: 201, run_id: 2 })],
      [makeJob({ id: 301, run_id: 3 })],
    ];
    setupFetch(runs, jobs);

    // Mark run 1 and run 3 as already existing
    const existingTraceId1 = generateWorkflowTraceId(TEST_REPO.id, 1, 1);
    const existingTraceId3 = generateWorkflowTraceId(TEST_REPO.id, 3, 1);
    setupDbMock([existingTraceId1, existingTraceId3]);

    const result = await backfillRepo(999, 1, TEST_REPO);

    expect(result.runsSkipped).toBe(2);
    expect(result.runsReplayed).toBe(1);
    expect(result.jobsReplayed).toBe(1);
    // Only run 2 + its job should be replayed
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });
});
