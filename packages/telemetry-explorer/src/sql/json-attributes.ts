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

// ClickHouse returns a JSON column as a nested object: a key `http.route`
// comes back as {"http":{"route":...}}. OTel attribute keys are flat, so the
// nesting is undone by joining with dots. Every leaf becomes text; 64-bit
// integers already arrive quoted.
export function flattenAttributes(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [name, leaf] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (leaf === null || leaf === undefined) continue;
      if (Array.isArray(leaf)) {
        out[key] = JSON.stringify(leaf);
        continue;
      }
      if (typeof leaf === "object") {
        walk(leaf as Record<string, unknown>, key);
        continue;
      }
      out[key] = String(leaf);
    }
  };
  walk(value as Record<string, unknown>, "");
  return out;
}
