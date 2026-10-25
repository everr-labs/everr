import { beforeEach, expect, it, vi } from "vite-plus/test";
import { query } from "#app/lib/clickhouse.ts";
import { consultTrace, getTrace } from "./server";
const { observe } = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock("#app/server/organizations/consultations.ts", () => ({ consultations: { observe } }));
const raw = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "abc",
  parentSpanId: "",
  serviceName: "checkout",
  spanName: "GET checkout",
  timestamp: "2026-10-23 12:00:00",
  timestampNs: "1792756800000000000",
  duration: "10",
  statusCode: "Ok",
  spanKind: "Server",
  resourceAttributes: { deployment: { environment: { name: "production" } } },
  spanAttributes: {},
  eventNames: [],
  eventTimestamps: [],
  eventAttributes: [],
  linkTraceIds: [],
  linkSpanIds: [],
  linkAttributes: [],
};
beforeEach(() => {
  vi.mocked(query).mockReset();
  observe.mockReset();
});
it("observes explicit UI detail only after its successful Organization-scoped read", async () => {
  vi.mocked(query).mockResolvedValue([raw]);
  const rows = await consultTrace({ data: { traceId: raw.traceId } });
  expect(rows[0].traceId).toBe(raw.traceId);
  expect(observe).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      principal: expect.objectContaining({
        organizationId: "test_org",
        userId: "test_user",
        membershipId: "test_membership",
      }),
      surface: "ui",
      traces: [expect.objectContaining({ traceId: raw.traceId })],
    }),
  );
});
it("leaves refresh, focus and background reads on getTrace unobserved", async () => {
  vi.mocked(query).mockResolvedValue([raw]);
  await getTrace({ data: { traceId: raw.traceId } });
  await getTrace({ data: { traceId: raw.traceId } });
  expect(observe).not.toHaveBeenCalled();
});
it("does not observe empty or failed detail", async () => {
  vi.mocked(query).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("read failure"));
  expect(await consultTrace({ data: { traceId: raw.traceId } })).toEqual([]);
  await expect(consultTrace({ data: { traceId: raw.traceId } })).rejects.toThrow("read failure");
  expect(observe).not.toHaveBeenCalled();
});
it("returns the successful detail even when observation fails", async () => {
  vi.mocked(query).mockResolvedValue([raw]);
  observe.mockImplementation(() => {
    throw new Error("observer failed");
  });
  await expect(consultTrace({ data: { traceId: raw.traceId } })).resolves.toHaveLength(1);
});
