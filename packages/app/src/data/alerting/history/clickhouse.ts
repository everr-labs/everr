export function clickhouseIsoMillis(column: string): string {
  return `concat(formatDateTime(${column}, '%Y-%m-%dT%H:%i:%S', 'UTC'), '.', substring(formatDateTime(${column}, '%f', 'UTC'), 1, 3), 'Z')`;
}
