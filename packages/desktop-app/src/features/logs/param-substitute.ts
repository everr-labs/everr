const PLACEHOLDER = /\{(\w+):([A-Za-z0-9()]+)\}/g;

function escapeString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function renderValue(type: string, raw: unknown, name: string): string {
  if (type === "String") {
    if (raw === undefined || raw === null) return "''";
    if (typeof raw !== "string") {
      throw new Error(`param ${name}: expected string, got ${typeof raw}`);
    }
    return escapeString(raw);
  }
  if (
    type === "UInt32" ||
    type === "UInt64" ||
    type === "Int32" ||
    type === "Int64"
  ) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`param ${name}: expected number for ${type}`);
    }
    return String(Math.trunc(raw));
  }
  if (type === "Array(String)") {
    if (!Array.isArray(raw)) {
      throw new Error(`param ${name}: expected array for Array(String)`);
    }
    return `[${raw.map((v) => escapeString(String(v))).join(",")}]`;
  }
  throw new Error(`unsupported parameter type ${type} for param ${name}`);
}

export function substituteParams(
  sql: string,
  params: Record<string, unknown>,
): string {
  return sql.replace(PLACEHOLDER, (_match, name: string, type: string) => {
    if (!(name in params)) {
      throw new Error(`missing parameter ${name}`);
    }
    return renderValue(type, params[name], name);
  });
}
