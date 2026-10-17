import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@app/ingestion", () => ({
  internalIngestHeaders: (organizationId: string) => ({
    "x-test-workspace": organizationId,
  }),
}));
vi.mock("@/integrations/github/configuration", () => ({
  requireGithubConfiguration: () => ({
    INGRESS_COLLECTOR_URL: "http://collector.test/webhook/github",
  }),
}));
vi.mock("@/lib/retention.server", () => ({
  retentionForOrg: vi.fn(),
}));

import { retentionForOrg } from "@/lib/retention.server";
import { retentionForDays } from "@/product/retention.test-fixtures";
import { replayWebhookToCollector } from "./collector";

describe("replayWebhookToCollector", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends configured identity and retention headers to the collector", async () => {
    vi.mocked(retentionForOrg).mockResolvedValueOnce(retentionForDays(14));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await replayWebhookToCollector(
      { headers: { "x-github-event": ["push"] }, body: Buffer.from("{}") },
      "org_7",
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get("x-test-workspace")).toBe("org_7");
    expect(headers.get("x-everr-retention-logs-days")).toBe("14");
    expect(headers.get("x-everr-retention-traces-days")).toBe("14");
    expect(headers.get("x-everr-retention-metrics-days")).toBe("14");
    expect(retentionForOrg).toHaveBeenCalledWith("org_7");
  });
});
