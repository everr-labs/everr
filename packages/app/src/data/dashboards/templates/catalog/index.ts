import { dashboardSpecSchemaStrict } from "../../schema";
import type { DashboardTemplate } from "../types";
import { TEMPLATE_CATEGORIES } from "../types";
import { applicationTemplates } from "./application";
import { browserTemplates } from "./browser";
import { databaseTemplates } from "./databases";
import { infrastructureTemplates } from "./infrastructure";
import { logTemplates } from "./logs";
import { runtimeTemplates } from "./runtime";

/**
 * Every template the gallery can offer, ordered by category and then by the
 * order each module declares. Nothing here is stored per Organization: a
 * template is a starting point, and creating a Dashboard from one copies the
 * document rather than linking to it.
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  ...applicationTemplates,
  ...logTemplates,
  ...runtimeTemplates,
  ...databaseTemplates,
  ...infrastructureTemplates,
  ...browserTemplates,
].sort(
  (a, b) =>
    TEMPLATE_CATEGORIES.indexOf(a.category) -
    TEMPLATE_CATEGORIES.indexOf(b.category),
);

const BY_ID = new Map(DASHBOARD_TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): DashboardTemplate | undefined {
  return BY_ID.get(id);
}

/** Panel count, shown on every row. Derived so it can never fall out of date. */
export function panelCount(template: DashboardTemplate): number {
  return Object.keys(template.document.spec.panels).length;
}

/**
 * Validates the whole catalog against the same strict schema `everr apply`
 * uses, so a template that would be rejected as a file is rejected here too.
 * Exported for the catalog test rather than run at import time: the gallery
 * must not pay for validation on every page load.
 */
export function validateCatalog(): void {
  const ids = new Set<string>();
  for (const template of DASHBOARD_TEMPLATES) {
    if (ids.has(template.id)) {
      throw new Error(`Duplicate template id: ${template.id}`);
    }
    ids.add(template.id);
    dashboardSpecSchemaStrict.parse(template.document.spec);
  }
}
