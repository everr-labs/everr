import { describe, expect, it } from "vitest";
import {
  boundEventEvidence,
  boundEvidence,
  MAX_EVENT_EVIDENCE_COLUMNS,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_ROWS,
} from "./evidence";

describe("boundEvidence", () => {
  it("caps row count", () => {
    const result = boundEvidence(
      Array.from({ length: 60 }, (_, index) => ({ index })),
    );
    expect(JSON.parse(result.json)).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(result.rowCount).toBe(60);
    expect(result.truncated).toBe(true);
  });

  it("caps serialized bytes", () => {
    const result = boundEvidence(
      Array.from({ length: 50 }, () => ({ value: "x".repeat(4_000) })),
    );
    expect(Buffer.byteLength(result.json, "utf8")).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES,
    );
    expect(result.truncated).toBe(true);
  });
});

describe("boundEventEvidence", () => {
  it("omits label columns and caps non-label columns", () => {
    const row: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`column_${index}`, index]),
    );
    row.service = "api";
    const result = boundEventEvidence(row, { service: "api" });
    expect(result.evidence).not.toHaveProperty("service");
    expect(Object.keys(result.evidence)).toHaveLength(
      MAX_EVENT_EVIDENCE_COLUMNS,
    );
    expect(result.truncated).toBe(true);
  });

  it("drops evidence that exceeds the byte cap", () => {
    expect(
      boundEventEvidence({ body: "x".repeat(5_000) }, {}).evidence,
    ).toEqual({});
    expect(boundEventEvidence({ body: "x".repeat(5_000) }, {}).truncated).toBe(
      true,
    );
  });
});
