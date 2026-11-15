// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Session from "./session.ts";

const deployment = vi.hoisted(() => ({ sessionRecordings: true }));
vi.mock("@composition/client", () => ({ productClient: deployment }));
vi.mock("./session.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Session>()),
  clipEvents: vi.fn(),
}));

import { query } from "#app/lib/clickhouse.ts";
import { getClipEvents, getCoveringClips } from "./server";
import { clipEvents } from "./session.ts";

const recorded = {
  events: [{ type: 2, timestamp: 1_000, data: { node: {} } }],
  gaps: [{ kind: "piece" as const, streamId: "s1", eventIndex: 3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  deployment.sessionRecordings = true;
});

describe("session recording server functions", () => {
  it("refuse both reads where recordings are not stored", async () => {
    deployment.sessionRecordings = false;

    await expect(getCoveringClips({ data: { kind: "trace", traceId: "t1" } })).rejects.toThrow(
      "Session recordings are not available",
    );
    await expect(getClipEvents({ data: { clipId: "c1", startMs: 1_000 } })).rejects.toThrow(
      "Session recordings are not available",
    );
    expect(query).not.toHaveBeenCalled();
    expect(clipEvents).not.toHaveBeenCalled();
  });

  it("send a Clip's events gzip encoded, without caching headers", async () => {
    vi.mocked(clipEvents).mockResolvedValue(recorded);

    const response = await getClipEvents({ data: { clipId: "c1", startMs: 1_000 } });

    expect(clipEvents).toHaveBeenCalledWith("test_org", "c1", 1_000);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("cache-control")).toBeNull();
    const body = gunzipSync(Buffer.from(await response.arrayBuffer())).toString();
    expect(JSON.parse(body)).toEqual(recorded);
  });
});
