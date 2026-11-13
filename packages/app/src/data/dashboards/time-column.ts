/**
 * The column names a panel query may use for its time axis. The client picks
 * the first column with one of these names, and the server's downsampling
 * wrapper must agree with it. Keep the docs' list in sync.
 */
const TIME_COLUMN_NAME = /^(ts|time|timestamp)$/i;

export function isTimeColumnName(name: string): boolean {
  return TIME_COLUMN_NAME.test(name);
}
