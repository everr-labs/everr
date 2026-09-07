import { attributeKeysColumn, attributeText } from "../../sql/json-attributes";
import type { AttributeFilter, AttributeSource } from "../schemas";

// Builds the attribute predicates shared by every domain's WHERE clause.
// `columnFor` maps a source to its JSON attribute column. The key goes into
// the SQL text as a quoted identifier, because only `col.`key`` reads that
// path's subcolumn, and into a parameter for the keys-array test, which the
// bloom index prunes. `startIndex` lets a caller that already has positional
// params avoid name collisions. Param names are `attrKey{i}` / `attrVals{i}`.
export function buildAttributeClauses(
  attributes: AttributeFilter[],
  columnFor: (source: AttributeSource) => string,
  startIndex = 0,
): { clauses: string[]; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  attributes.forEach((filter, i) => {
    const index = startIndex + i;
    const column = columnFor(filter.source);
    const keyParam = `attrKey${index}`;
    const valsParam = `attrVals${index}`;
    const exists = `has(${attributeKeysColumn(column)}, {${keyParam}:String})`;
    const text = attributeText(column, filter.key);

    switch (filter.op) {
      case "in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(`${exists} AND ${text} IN {${valsParam}:Array(String)}`);
        params[valsParam] = filter.values;
        break;
      case "not_in":
        // Require the key to exist: "is not" means present with a different
        // value, not absent. The dedicated `missing` op covers absence, which
        // keeps the four operators a clean partition: in plus not_in equals
        // exists.
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(
          `(${exists} AND ${text} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        params[keyParam] = filter.key;
        clauses.push(exists);
        break;
      case "missing":
        params[keyParam] = filter.key;
        clauses.push(`NOT ${exists}`);
        break;
    }
  });

  return { clauses, params };
}
