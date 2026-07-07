export function sortedLabelEntries(
  labels: Record<string, string>,
): [string, string][] {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
}
