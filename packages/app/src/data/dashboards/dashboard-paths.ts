/**
 * True when `pathname` is the dashboard route rooted at `prefix` or one of its
 * child routes (e.g. `/settings`, `/panel/<key>`). Uses a path-segment boundary
 * so a sibling slug like `${prefix}-copy` does NOT count as "within" — a plain
 * `startsWith(prefix)` would wrongly match it and let a dirty dashboard navigate
 * away without the unsaved-changes prompt.
 */
export function isWithinDashboardPath(
  pathname: string,
  prefix: string,
): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
