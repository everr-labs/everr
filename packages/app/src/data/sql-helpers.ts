/**
 * SQL expression to build the full test name from parent_test and test name.
 * Uses "/" as the join separator for deduplication purposes.
 *
 * Note: this produces a compound key for grouping, not a display name.
 * Test frameworks use different native separators for display:
 * - Vitest: " > " (e.g., "pkg > Describe > test")
 * - Rust: "::" (e.g., "module::suite::test")
 * - Go: "/" (e.g., "TestSuite/SubTest")
 * See `testNameSeparator()` in lib/formatting.ts for display parsing.
 *
 * @param alias - Column alias (e.g., "test_full_name"). Pass `null` to omit the alias.
 * @param parentAttr - SQL expression for the parent test attribute.
 * @param nameAttr - SQL expression for the test name attribute.
 */
export function testFullNameExpr(
  alias: string | null = "test_full_name",
  parentAttr = "SpanAttributes['everr.test.parent_test']",
  nameAttr = "SpanAttributes['everr.test.name']",
): string {
  const expr = `if(${parentAttr} != '', concat(${parentAttr}, '/', ${nameAttr}), ${nameAttr})`;
  return alias ? `${expr} as ${alias}` : expr;
}
