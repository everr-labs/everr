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
  it("parses the m/h/d/w vocabulary", () => {
    expect(parseSloWindowSeconds("5m")).toBe(300);
    expect(parseSloWindowSeconds("1h")).toBe(3600);
    expect(parseSloWindowSeconds("3d")).toBe(259_200);
    expect(parseSloWindowSeconds("1w")).toBe(604_800);
  });

  it("rejects calendar units, seconds, zero, and the over-cap window", () => {
    // CC's SLO windows have no seconds unit (unlike AlertRule durations) and
    // no calendar units; values must be positive and at most 366 days.
    for (const bad of ["30s", "1M", "1Q", "10", "0d", "abc", "", "700000w"]) {
      expect(() => parseSloWindowSeconds(bad)).toThrow();
    }
    expect(parseSloWindowSeconds("366d")).toBe(366 * 86_400);
  });
});

describe("SloYamlSchema", () => {
  it("accepts a minimal document and normalizes the timeWindow shorthand", () => {
    const parsed = SloYamlSchema.parse(sloDoc());
    expect(parsed.metadata.name).toBe("checkout-availability");
    expect(parsed.spec.timeWindow).toBe("30d");
    expect(parsed.spec.sli.labelColumns).toEqual(["service"]);
  });

  it("accepts the object timeWindow form and normalizes it to the shorthand", () => {
    const parsed = SloYamlSchema.parse(
      sloDoc({ timeWindow: { duration: "7d", isRolling: true } }),
    );
    expect(parsed.spec.timeWindow).toBe("7d");
  });

  it("rejects calendar windows (isRolling: false) like CC does", () => {
    expect(
      firstMessage(
        sloDoc({ timeWindow: { duration: "7d", isRolling: false } }),
      ),
    ).toMatch(/calendar-aligned windows are not supported/);
  });

  it("accepts a full document (project, labels, tiers, minValidEvents, annotations)", () => {
    const parsed = SloYamlSchema.parse({
      kind: "SLO",
      metadata: {
        name: "checkout",
        project: "payments",
        labels: { team: "payments" },
      },
      spec: {
        sli: { sql: SQL, labelColumns: ["service"] },
        targetPercent: 99.5,
        timeWindow: "30d",
        minValidEvents: 1000,
        tiers: [
          {
            name: "fast-burn",
            longWindow: "1h",
            shortWindow: "5m",
            burnRate: 14.4,
            severity: "critical",
          },
        ],
        annotations: { runbook: "https://example.com/rb" },
      },
    });
    expect(parsed.metadata.project).toBe("payments");
    expect(parsed.spec.tiers?.[0]?.burnRate).toBe(14.4);
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

  it("rejects unparsable and over-cap window durations with the value in the message", () => {
    expect(firstMessage(sloDoc({ timeWindow: "1M" }))).toMatch(/"1M"/);
    expect(firstMessage(sloDoc({ timeWindow: "700000w" }))).toMatch(
      /exceeds the maximum of 366 days/,
    );
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
    // A merely similar name stays allowed.
    expect(
      SloYamlSchema.safeParse(
        sloDoc({ sli: { sql: SQL, labelColumns: ["slo_name"] } }),
      ).success,
    ).toBe(true);
  });

  it("rejects malformed tiers (long <= short, burnRate <= 0, empty name, empty list)", () => {
    const tier = {
      name: "fast-burn",
      longWindow: "1h",
      shortWindow: "5m",
      burnRate: 14.4,
      severity: "critical",
    };
    expect(
      firstMessage(sloDoc({ tiers: [{ ...tier, longWindow: "5m" }] })),
    ).toMatch(/longWindow must be greater than shortWindow/);
    expect(firstMessage(sloDoc({ tiers: [{ ...tier, burnRate: 0 }] }))).toMatch(
      /burnRate must be > 0/,
    );
    expect(firstMessage(sloDoc({ tiers: [{ ...tier, name: "  " }] }))).toMatch(
      /tier name must not be empty/,
    );
    expect(SloYamlSchema.safeParse(sloDoc({ tiers: [] })).success).toBe(false);
  });

  it("rejects reserved everr.* annotation keys", () => {
    expect(
      firstMessage(sloDoc({ annotations: { "everr.name": "x" } })),
    ).toMatch(/"everr\.name" is reserved/);
  });

  it("enforces CC's SLO name rules at parse time", () => {
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
