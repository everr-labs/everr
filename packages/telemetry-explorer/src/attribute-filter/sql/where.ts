import type { AttributeFilter, AttributeSource } from "../schemas";

// Builds the attribute-map predicates shared by every domain's WHERE clause.
// `columnFor` maps a source to its ClickHouse Map column; `startIndex` lets a
// caller that already has positional params avoid name collisions. Param names
// are `attrKey{i}` / `attrVals{i}`.
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
    const contains = `mapContains(${column}, {${keyParam}:String})`;
    const access = `${column}[{${keyParam}:String}]`;

    switch (filter.op) {
      case "in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(`${contains} AND ${access} IN {${valsParam}:Array(String)}`);
        params[valsParam] = filter.values;
        break;
      case "not_in":
        // Require the key to exist: "is not" means present-with-a-different
        // value, not absent. The dedicated `missing` op covers absence, which
        // keeps the four operators a clean partition (in ∪ not_in = exists).
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(`(${contains} AND ${access} NOT IN {${valsParam}:Array(String)})`);
        params[valsParam] = filter.values;
        break;
      case "exists":
        params[keyParam] = filter.key;
        clauses.push(contains);
        break;
      case "missing":
        params[keyParam] = filter.key;
        clauses.push(`NOT ${contains}`);
        break;
    }
  });

  return { clauses, params };
}
