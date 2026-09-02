import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

// Only so that importing the assembler for its comparator does not build a
// real database pool.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import type { AlertingSeverity } from "@/data/alerting/types";
import { ALERTING_SEVERITIES } from "@/data/alerting/vocabulary";
import { byTriageOrder } from "./assemble";
import { compareRuleLabels } from "./format";
import type { TriageAlert, TriageStatus } from "./view";

/**
 * Both orders on this screen are comparators handed to `Array.prototype.sort`,
 * and a comparator that is not a total order gives an engine-dependent result:
 * the same board can come out in a different order on a different runtime, or
 * on the same runtime for a different number of rows. Examples cannot find
 * that. These generate triples and check the two laws sort relies on.
 */

/** `|| 0` folds the negative zero `Math.sign` gives back, which `toBe`
 *  otherwise reports as different from positive zero. */
const sign = (n: number) => Math.sign(n) || 0;

/** A rule as the inventory sorts it: what it prints, and what identifies it. */
const ruleArb = fc.record({
  label: fc.string({ maxLength: 8 }),
  path: fc.string({ minLength: 1, maxLength: 8 }),
});

const STATUSES: TriageStatus[] = ["degraded", "firing", "pending"];

/** Only the three fields the board's order reads. */
const alertArb = fc
  .record({
    status: fc.constantFrom(...STATUSES),
    severity: fc.constantFrom<AlertingSeverity>(...ALERTING_SEVERITIES),
    silenced: fc.boolean(),
  })
  .map(
    ({ status, severity, silenced }) =>
      ({
        status,
        severity,
        ...(silenced ? { silence: { id: "s" } } : {}),
      }) as TriageAlert,
  );

function laws<T>(
  name: string,
  arb: fc.Arbitrary<T>,
  cmp: (a: T, b: T) => number,
) {
  describe(name, () => {
    it("reverses sign when its two sides are swapped", () => {
      fc.assert(
        fc.property(arb, arb, (a, b) => {
          expect(sign(cmp(a, b))).toBe(sign(-cmp(b, a)));
        }),
      );
    });

    it("carries through a chain of three", () => {
      fc.assert(
        fc.property(arb, arb, arb, (a, b, c) => {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
            expect(cmp(a, c)).toBeLessThanOrEqual(0);
          }
        }),
      );
    });

    it("treats two things it calls equal as interchangeable against a third", () => {
      fc.assert(
        fc.property(arb, arb, arb, (a, b, c) => {
          if (cmp(a, b) === 0) {
            expect(sign(cmp(a, c))).toBe(sign(cmp(b, c)));
          }
        }),
      );
    });

    it("never answers with something that is not a number", () => {
      fc.assert(
        fc.property(arb, arb, (a, b) => {
          expect(Number.isFinite(cmp(a, b))).toBe(true);
        }),
      );
    });
  });
}

laws("the order the rule inventory prints in", ruleArb, compareRuleLabels);
laws("the order the Triage board prints in", alertArb, byTriageOrder);
