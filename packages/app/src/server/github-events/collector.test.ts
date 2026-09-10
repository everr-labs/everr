import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { INGRESS_COLLECTOR_URL: "http://collector.test/webhook/github" },
}));
vi.mock("@/lib/retention.server", () => ({
  retentionForOrg: vi.fn(),
}));

import { resolveRetention } from "@/lib/retention";
import { retentionForOrg } from "@/lib/retention.server";
import { replayWebhookToCollector } from "./collector";

describe("replayWebhookToCollector", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends tenant and retention headers to the collector", async () => {
    vi.mocked(retentionForOrg).mockResolvedValueOnce(resolveRetention("free"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await replayWebhookToCollector(
      { headers: { "x-github-event": ["push"] }, body: Buffer.from("{}") },
      "org_7",
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get("x-everr-tenant-id")).toBe("org_7");
    expect(headers.get("x-everr-retention-logs-days")).toBe("14");
    expect(headers.get("x-everr-retention-traces-days")).toBe("14");
    expect(headers.get("x-everr-retention-metrics-days")).toBe("14");
    expect(retentionForOrg).toHaveBeenCalledWith("org_7");
  });
});
