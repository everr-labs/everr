import { describe, expect, it } from "vitest";
import { parseSloWindowSeconds, SloYamlSchema } from "./schema";

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

function sloDoc(overrides: Record<string, unknown> = {}) {
  return {
    kind: "SLO",
    metadata: { name: "checkout-availability" },
    spec: {
      sli: { sql: SQL, labelColumns: ["service"] },
      targetPercent: 99.9,
      timeWindow: "30d",
      ...overrides,
    },
  };
}

function firstMessage(doc: unknown): string {
  const parsed = SloYamlSchema.safeParse(doc);
  if (parsed.success) throw new Error("expected the document to be rejected");
  return parsed.error.issues[0]?.message ?? "";
}

describe("parseSloWindowSeconds", () => {
  it("parses the m/h/d/w vocabulary within the 1d..366d bounds", () => {
    expect(parseSloWindowSeconds("24h")).toBe(86_400);
    expect(parseSloWindowSeconds("3d")).toBe(259_200);
    expect(parseSloWindowSeconds("1w")).toBe(604_800);
    expect(parseSloWindowSeconds("366d")).toBe(366 * 86_400);
    // No calendar units, no seconds, nothing below a day or over the cap.
    for (const bad of [
      "30s",
      "1M",
      "1Q",
      "10",
      "0d",
      "23h",
      "5m",
      "abc",
      "",
      "700000w",
    ]) {
      expect(() => parseSloWindowSeconds(bad)).toThrow();
    }
  });
});

describe("SloYamlSchema", () => {
  it("normalizes the object timeWindow form and rejects calendar windows like CC does", () => {
    const parsed = SloYamlSchema.parse(
      sloDoc({ timeWindow: { duration: "7d", isRolling: true } }),
    );
    expect(parsed.spec.timeWindow).toBe("7d");
    expect(
      firstMessage(
        sloDoc({ timeWindow: { duration: "7d", isRolling: false } }),
      ),
    ).toMatch(/calendar-aligned windows are not supported/);
    // The duration parser's own message reaches the caller, naming the value.
    expect(firstMessage(sloDoc({ timeWindow: "1M" }))).toMatch(/"1M"/);
    expect(firstMessage(sloDoc({ timeWindow: "1h" }))).toMatch(
      /minimum of 1 day/,
    );
    expect(firstMessage(sloDoc({ timeWindow: "700000w" }))).toMatch(
      /exceeds the maximum of 366 days/,
    );
  });

  it("rejects SQL missing either window placeholder", () => {
    const noWindow = "SELECT countIf(ok) AS good, count() AS valid FROM t";
    expect(firstMessage(sloDoc({ sli: { sql: noWindow } }))).toMatch(
      /window_start.*window_end/,
    );
    const halfWindow = `${noWindow} WHERE ts >= {window_start:DateTime}`;
    expect(firstMessage(sloDoc({ sli: { sql: halfWindow } }))).toMatch(
      /window_start.*window_end/,
    );
  });

  it("rejects targetPercent outside (0, 100)", () => {
    for (const target of [0, 100, 150, -1]) {
      expect(firstMessage(sloDoc({ targetPercent: target }))).toMatch(
        /targetPercent must be > 0 and < 100/,
      );
    }
  });

  it("rejects reserved label columns (__cc_ prefix and pipeline-injected names)", () => {
    expect(
      firstMessage(sloDoc({ sli: { sql: SQL, labelColumns: ["__cc_x"] } })),
    ).toMatch(/reserved "__cc_" prefix/);
    for (const reserved of ["slo", "slo_tier"]) {
      expect(
        firstMessage(
          sloDoc({ sli: { sql: SQL, labelColumns: ["service", reserved] } }),
        ),
      ).toMatch(/collides with a label the SLO pipeline injects/);
    }
    expect(
      SloYamlSchema.safeParse(
        sloDoc({ sli: { sql: SQL, labelColumns: ["slo_name"] } }),
      ).success,
    ).toBe(true);
  });

  it("rejects the annotation keys the mapping layer generates, not just everr.*", () => {
    expect(
      firstMessage(sloDoc({ annotations: { "everr.name": "x" } })),
    ).toMatch(/"everr\.name" is reserved/);
    expect(
      firstMessage(
        sloDoc({ annotations: { "link.runbook": "https://example.com" } }),
      ),
    ).toMatch(/"link\.runbook" is reserved/);
    expect(
      firstMessage(sloDoc({ annotations: { summary: "custom summary" } })),
    ).toMatch(/"summary" is reserved/);
    expect(
      SloYamlSchema.safeParse(sloDoc({ annotations: { team: "payments" } }))
        .success,
    ).toBe(true);
  });

  it("enforces CC's SLO name rules and the runbook ref grammar at parse time", () => {
    const named = (name: string) => ({
      ...sloDoc(),
      metadata: { name },
    });
    expect(SloYamlSchema.safeParse(named("checkout.v2-a_b")).success).toBe(
      true,
    );
    for (const bad of ["", "has space", "x".repeat(129), "emoji✨"]) {
      expect(firstMessage(named(bad))).toMatch(/1-128 chars/);
    }
    for (const bad of ["a/b/c", ""]) {
      expect(SloYamlSchema.safeParse(sloDoc({ runbook: bad })).success).toBe(
        false,
      );
    }
  });

  it("is strict: unknown keys anywhere are rejected", () => {
    expect(SloYamlSchema.safeParse(sloDoc({ extra: true })).success).toBe(
      false,
    );
    expect(SloYamlSchema.safeParse({ ...sloDoc(), stray: 1 }).success).toBe(
      false,
    );
    expect(
      SloYamlSchema.safeParse(
        sloDoc({ sli: { sql: SQL, label_columns: ["service"] } }),
      ).success,
    ).toBe(false);
  });
});
