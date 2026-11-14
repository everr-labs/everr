type JsonAttributeValue = string | number | boolean | null | JsonAttributeValue[] | JsonAttributes;

export type JsonAttributes = { [key: string]: JsonAttributeValue };

// Attribute columns on logs and traces are ClickHouse JSON columns. A path is
// read as `column.`key``: that form reads only the path's subcolumn, while
// getSubcolumn(column, {key:String}) reads the whole column, so the key goes
// into the SQL text as an identifier and never into a parameter. Quoted
// identifiers and string literals both use backslash escapes.
function quoteIdentifier(name: string): string {
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function jsonPath(column: string, key: string): string {
  return `${column}.${quoteIdentifier(key)}`;
}

// Values are typed, so a read goes through toString: string equality whatever
// the producer sent, the same subcolumn read, and '' for a missing key, which
// is what the Map column gave.
export function attributeText(column: string, key: string): string {
  return `toString(${jsonPath(column, key)})`;
}

export function attributeKeysColumn(column: string): string {
  return `${column}Keys`;
}

// Presence is tested on the keys array, which the bloom index serves. A test
// on the value reads the subcolumn of every granule instead.
export function attributeExists(column: string, key: string): string {
  return `has(${attributeKeysColumn(column)}, ${quoteLiteral(key)})`;
}

// Keys semconv renamed, with the names they replaced. Services in the wild
// send either, so a filter or a value list on the current key also reads the
// old one.
const PREVIOUS_KEYS: Readonly<Record<string, readonly string[]>> = {
  "deployment.environment.name": ["deployment.environment"],
};

/** The key and the older names it replaced, current first. */
export function attributeKeyNames(key: string): readonly string[] {
  return [key, ...(PREVIOUS_KEYS[key] ?? [])];
}

/** Whether any name of the key is present. */
export function attributeExistsAny(column: string, key: string): string {
  const names = attributeKeyNames(key);
  if (names.length === 1) return attributeExists(column, key);
  return `(${names.map((name) => attributeExists(column, name)).join(" OR ")})`;
}

/** The value under the first name of the key that is present, '' when none is. */
export function attributeTextAny(column: string, key: string): string {
  const names = attributeKeyNames(key);
  return names
    .slice(0, -1)
    .reduceRight(
      (rest, name) =>
        `if(${attributeExists(column, name)}, ${attributeText(column, name)}, ${rest})`,
      attributeText(column, names[names.length - 1]),
    );
}

// ClickHouse returns a JSON column as a nested object: a key `http.route`
// comes back as {"http":{"route":...}}. OTel attribute keys are flat, so the
// nesting is undone by joining with dots. Every leaf becomes text; 64-bit
// integers already arrive quoted.
export function flattenAttributes(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  const walk = (node: object, prefix: string) => {
    const entries: [string, unknown][] = Object.entries(node);
    for (const [name, leaf] of entries) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (leaf === null || leaf === undefined) continue;
      if (Array.isArray(leaf)) {
        out[key] = JSON.stringify(leaf);
        continue;
      }
      if (typeof leaf === "object") {
        walk(leaf, key);
        continue;
      }
      // oxlint-disable-next-line typescript/no-base-to-string -- Preserve the existing String conversion for every non-null attribute leaf, including custom primitive values.
      out[key] = String(leaf);
    }
  };
  walk(value, "");
  return out;
}
