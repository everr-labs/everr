import { dashboardSlugSchema, dashboardSpecSchemaStrict } from "../../schema";
import type { BuiltinDashboard } from "../types";
import { BUILTIN_CATEGORIES } from "../types";
import { applicationBuiltins } from "./application";
import { browserBuiltins } from "./browser";
import { databaseBuiltins } from "./databases";
import { infrastructureBuiltins } from "./infrastructure";
import { logBuiltins } from "./logs";
import { runtimeBuiltins } from "./runtime";

/**
 * Every Built-in dashboard, ordered by category and then by the order each
 * module declares. Nothing here is stored per Organization: built-ins render
 * live from the catalog under the reserved `built-in` pseudo-project, and an
 * editable copy is only ever made by an Agent applying it as code (ADR 0004).
 */
export const BUILTIN_DASHBOARDS: BuiltinDashboard[] = [
  ...applicationBuiltins,
  ...logBuiltins,
  ...runtimeBuiltins,
  ...databaseBuiltins,
  ...infrastructureBuiltins,
  ...browserBuiltins,
].sort(
  (a, b) =>
    BUILTIN_CATEGORIES.indexOf(a.category) -
    BUILTIN_CATEGORIES.indexOf(b.category),
);

const BY_ID = new Map(BUILTIN_DASHBOARDS.map((t) => [t.id, t]));

export function getBuiltinDashboard(id: string): BuiltinDashboard | undefined {
  return BY_ID.get(id);
}

/**
 * Validates the whole catalog against the same strict schema `everr apply`
 * uses, so a builtin that would be rejected as a file is rejected here too.
 * Exported for the catalog test rather than run at import time: the list
 * must not pay for validation on every page load.
 */
export function validateCatalog(): void {
  const ids = new Set<string>();
  for (const builtin of BUILTIN_DASHBOARDS) {
    if (ids.has(builtin.id)) {
      throw new Error(`Duplicate builtin id: ${builtin.id}`);
    }
    ids.add(builtin.id);
    // The id is the slug in `/dashboards/built-in/$slug` and in `everr
    // resources show`, so it answers to the same rule every as-code slug does.
    dashboardSlugSchema.parse(builtin.id);
    dashboardSpecSchemaStrict.parse(builtin.document.spec);
  }
}
