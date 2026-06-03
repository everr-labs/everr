import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

// Attributes promoted to dedicated top-level controls. Their "in" entry is owned
// by a dedicated combobox (e.g. the Environment filter), so it must be hidden
// from the generic attribute pills and the picker's add menu.
export const ENVIRONMENT_ATTRIBUTE: PromotedAttribute = {
  source: "resource",
  key: "deployment.environment",
};

function isDedicated(
  filter: AttributeFilter,
  dedicated: readonly PromotedAttribute[],
): boolean {
  return dedicated.some(
    (d) =>
      d.source === filter.source && d.key === filter.key && filter.op === "in",
  );
}

// Partition `attributes` into the dedicated-control entries (e.g. the Environment
// "in" filter) and the rest, which feed the generic attribute section. A legacy
// non-"in" entry for a dedicated key stays in `rest` so it is still shown and
// applied.
export function splitDedicatedAttributes(
  attributes: AttributeFilter[],
  dedicated: readonly PromotedAttribute[],
): { dedicated: AttributeFilter[]; rest: AttributeFilter[] } {
  const ded: AttributeFilter[] = [];
  const rest: AttributeFilter[] = [];
  for (const filter of attributes) {
    if (isDedicated(filter, dedicated)) ded.push(filter);
    else rest.push(filter);
  }
  return { dedicated: ded, rest };
}
