import { attributeKeysColumn, attributeText } from "../../sql/json-attributes";
import type { AttributeFilter, AttributeOp, AttributeSource } from "../schemas";

// Builds the attribute predicates shared by every domain's WHERE clause.
// `columnFor` maps a source to its JSON attribute column. The key goes into
// the SQL text as a quoted identifier, because only `col.`key`` reads that
// path's subcolumn, and into a parameter for the keys-array test, which the
// bloom index prunes. `startIndex` lets a caller that already has positional
// params avoid name collisions. Param names are `attrKey{i}` / `attrVals{i}`.
const COMPARISONS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

// The positive operator a negative one complements: a row matches `not_in`
// when it has the key and does not match `in`, and so on. A caller whose rows
// group into larger units (spans into traces) evaluates a negative operator as
// "no row of the unit matches the positive one".
export const NEGATED_ATTRIBUTE_OPS = {
  not_in: "in",
  not_contains: "contains",
  missing: "exists",
} as const satisfies Partial<Record<AttributeOp, AttributeOp>>;

export function isNegatedOp(op: AttributeOp): op is keyof typeof NEGATED_ATTRIBUTE_OPS {
  return op in NEGATED_ATTRIBUTE_OPS;
}

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
        clauses.push(`(${exists} AND ${text} NOT IN {${valsParam}:Array(String)})`);
        params[valsParam] = filter.values;
        break;
      case "contains":
      case "not_contains": {
        // Like not_in, "does not contain" means present with a value that
        // lacks the text; `missing` covers absence.
        const value = filter.values[0];
        if (!value) return;
        params[keyParam] = filter.key;
        params[valsParam] = value;
        const contains = `positionCaseInsensitiveUTF8(${text}, {${valsParam}:String}) > 0`;
        clauses.push(
          filter.op === "contains"
            ? `${exists} AND ${contains}`
            : `(${exists} AND NOT ${contains})`,
        );
        break;
      }
      case "matches": {
        // RE2 syntax, as ClickHouse's match() reads it.
        const value = filter.values[0];
        if (!value) return;
        params[keyParam] = filter.key;
        params[valsParam] = value;
        clauses.push(`${exists} AND match(${text}, {${valsParam}:String})`);
        break;
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        // Attribute values are read as text, so a value that is not a number
        // never matches a comparison.
        const value = Number(filter.values[0]);
        if (
          filter.values[0] === undefined ||
          filter.values[0].trim() === "" ||
          !Number.isFinite(value)
        )
          return;
        params[keyParam] = filter.key;
        params[valsParam] = value;
        clauses.push(
          `${exists} AND toFloat64OrNull(${text}) ${COMPARISONS[filter.op]} {${valsParam}:Float64}`,
        );
        break;
      }
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
