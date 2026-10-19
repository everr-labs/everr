import { server } from "@composition/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { retentionForOrg } from "#app/lib/retention.server.ts";
import { retentionForDays } from "#app/product/retention.test-fixtures.ts";
import { replayWebhookToCollector } from "./collector";

vi.mock("@composition/server", () => ({
  server: {
    telemetryTenantId: vi.fn<(organizationId: string) => string | undefined>(),
  },
}));
vi.mock("#app/integrations/github/configuration.ts", () => ({
  requireGithubConfiguration: () => ({
    INGRESS_COLLECTOR_URL: "http://collector.test/webhook/github",
  }),
}));
vi.mock("#app/lib/retention.server.ts", () => ({
  retentionForOrg: vi.fn(),
}));

describe("replayWebhookToCollector", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "org_7",
    undefined,
  ])("sends authoritative tenant %s and retention headers", async (tenantId) => {
    vi.mocked(server.telemetryTenantId).mockReturnValueOnce(tenantId);
    vi.mocked(retentionForOrg).mockResolvedValueOnce(retentionForDays(14));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await replayWebhookToCollector(
      {
        headers: {
          "x-github-event": ["push"],
          "x-everr-tenant-id": ["untrusted"],
        },
        body: Buffer.from("{}"),
      },
      "org_7",
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get("x-everr-tenant-id")).toBe(tenantId ?? null);
    expect(server.telemetryTenantId).toHaveBeenCalledWith("org_7");
    expect(headers.get("x-everr-retention-logs-days")).toBe("14");
    expect(headers.get("x-everr-retention-traces-days")).toBe("14");
    expect(headers.get("x-everr-retention-metrics-days")).toBe("14");
    expect(retentionForOrg).toHaveBeenCalledWith("org_7");
  });
});
