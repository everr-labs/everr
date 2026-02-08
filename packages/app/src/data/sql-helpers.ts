/**
 * SQL expression to build the full test name from parent_test and test name.
 * Used across flaky-tests and test-results queries.
 *
 * @param alias - Column alias (e.g., "test_full_name"). Pass `null` to omit the alias.
 * @param parentAttr - SQL expression for the parent test attribute.
 * @param nameAttr - SQL expression for the test name attribute.
 */
export function testFullNameExpr(
  alias: string | null = "test_full_name",
  parentAttr = "SpanAttributes['citric.test.parent_test']",
  nameAttr = "SpanAttributes['citric.test.name']",
): string {
  const expr = `if(${parentAttr} != '', concat(${parentAttr}, '/', ${nameAttr}), ${nameAttr})`;
  return alias ? `${expr} as ${alias}` : expr;
}
