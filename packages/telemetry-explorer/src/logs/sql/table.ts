const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

export function validateTableName(name: string): void {
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error(`invalid table name: ${name}`);
  }
}
