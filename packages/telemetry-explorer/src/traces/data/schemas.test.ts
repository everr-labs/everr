import { describe, expect, it } from "vite-plus/test";
import { TraceDetailParamsSchema, toTraceListSearch } from "./schemas";

describe("TraceDetailParamsSchema", () => {
  it("preserves trace list filters on detail URLs", () => {
    const parsed = TraceDetailParamsSchema.parse({
      from: "2026-05-21T10:00:00.000Z",
      to: "2026-05-21T11:00:00.000Z",
      refresh: "30s",
      namespace: ["api"],
      service: ["web"],
      name: "GET /runs",
      minMs: 10,
      maxMs: 500,
      status: "error",
      start: "2026-05-21T10:12:00.000Z",
      end: "2026-05-21T10:12:02.000Z",
      span: "span-1",
    });

    expect(parsed).toMatchObject({
      namespace: ["api"],
      service: ["web"],
      name: "GET /runs",
      minMs: 10,
      maxMs: 500,
      status: "error",
      start: "2026-05-21T10:12:00.000Z",
      end: "2026-05-21T10:12:02.000Z",
      span: "span-1",
    });
  });
});

describe("toTraceListSearch", () => {
  it("drops detail-only params while preserving trace list filters", () => {
    const detailSearch = TraceDetailParamsSchema.parse({
      from: "2026-05-21T10:00:00.000Z",
      to: "2026-05-21T11:00:00.000Z",
      refresh: "30s",
      namespace: ["api"],
      service: ["web"],
      name: "GET /runs",
      minMs: 10,
      maxMs: 500,
      status: "error",
      start: "2026-05-21T10:12:00.000Z",
      end: "2026-05-21T10:12:02.000Z",
      span: "span-1",
    });

    expect(toTraceListSearch(detailSearch)).toEqual({
      from: "2026-05-21T10:00:00.000Z",
      to: "2026-05-21T11:00:00.000Z",
      refresh: "30s",
      namespace: ["api"],
      service: ["web"],
      name: "GET /runs",
      minMs: 10,
      maxMs: 500,
      status: "error",
      attributes: [],
    });
  });
});
