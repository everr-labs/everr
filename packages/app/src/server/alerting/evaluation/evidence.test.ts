import { describe, expect, it } from "vite-plus/test";
import {
  boundEventEvidence,
  boundEvidence,
  MAX_EVENT_EVIDENCE_BYTES,
  MAX_EVENT_EVIDENCE_COLUMNS,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_ROWS,
} from "./evidence";

describe("boundEvidence", () => {
  it("caps row count", () => {
    const result = boundEvidence(Array.from({ length: 60 }, (_, index) => ({ index })));
    expect(JSON.parse(result.json)).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(result.rowCount).toBe(60);
    expect(result.truncated).toBe(true);
  });

  it("caps serialized bytes", () => {
    const result = boundEvidence(Array.from({ length: 50 }, () => ({ value: "x".repeat(4_000) })));
    expect(Buffer.byteLength(result.json, "utf8")).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES);
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
    expect(Object.keys(result.evidence)).toHaveLength(MAX_EVENT_EVIDENCE_COLUMNS);
    expect(result.truncated).toBe(true);
  });

  it("shrinks the longest value to fit and keeps the small ones", () => {
    const result = boundEventEvidence(
      { service: "checkout", stacktrace: "x".repeat(MAX_EVENT_EVIDENCE_BYTES * 2), occurrences: 3 },
      {},
    );
    expect(result.truncated).toBe(true);
    expect(result.evidence).toMatchObject({ service: "checkout", occurrences: 3 });
    const stacktrace = String(result.evidence.stacktrace);
    expect(stacktrace).toMatch(/^x+…$/);
    expect(Buffer.byteLength(JSON.stringify(result.evidence))).toBeLessThanOrEqual(
      MAX_EVENT_EVIDENCE_BYTES,
    );
    // Cut no further than it had to.
    expect(Buffer.byteLength(JSON.stringify(result.evidence))).toBeGreaterThan(
      MAX_EVENT_EVIDENCE_BYTES - 8,
    );
  });

  it("never cuts a character in half", () => {
    const result = boundEventEvidence({ message: "😀".repeat(2_000) }, {});
    expect(String(result.evidence.message)).toMatch(/^(😀)+…$/u);
  });

  it("leaves out a large value that is not text", () => {
    const result = boundEventEvidence(
      { service: "checkout", rows: Array.from({ length: 2_000 }, (_, index) => index) },
      {},
    );
    expect(result.evidence).toEqual({ service: "checkout" });
    expect(result.truncated).toBe(true);
  });

  it("keeps evidence under the byte cap as it is", () => {
    const result = boundEventEvidence({ service: "checkout", message: "boom" }, {});
    expect(result).toEqual({
      evidence: { service: "checkout", message: "boom" },
      truncated: false,
    });
  });
});
