// ClickHouse has no per-function access control: readonly=1 and the
// sql_api_role grants still leave every built-in scalar function callable, so
// server-introspection functions (hostName(), uptime(), ...) would leak infra
// details to tenants. This guard rejects the query before it reaches
// ClickHouse. Matching is case-insensitive because some names are registered
// as case-insensitive aliases (FQDN → fqdn) — over-matching a differently
// cased user alias is the safe direction.
const BLOCKED_FUNCTIONS = [
  // Hostname of the ClickHouse server
  "hostName",
  "hostname", // alias of hostName
  "FQDN", // case-insensitive
  "fullHostName", // alias of FQDN
  "displayName", // falls back to the hostname when display_name is unset
  // Server uptime
  "uptime",
  "zookeeperSessionUptime",
  // Other server-identity introspection with no tenant-facing use
  "serverUUID",
  "tcpPort",
  "getServerPort",
  "getOSKernelVersion",
  "getMacro",
  "getServerSetting",
  "buildId",
] as const;

const BLOCKED_PATTERN = new RegExp(
  `\\b(${[...new Set(BLOCKED_FUNCTIONS.map((name) => name.toLowerCase()))].join("|")})\\b`,
  "i",
);

// Blank out single-quoted string literals and comments so words inside them
// (e.g. SpanAttributes['process.uptime']) don't trip the scanner. Backtick and
// double-quoted identifiers are intentionally KEPT: `hostName`() is a valid
// function call and must still match. The stripper is deliberately
// conservative — anything it fails to recognize as a literal stays in the text
// and can only cause a false rejection, never a bypass.
function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") {
          i += 2;
        } else if (sql[i] === "'") {
          // '' inside a literal is an escaped quote, not the terminator
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      out += " ";
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Throw if the SQL references a blocked server-introspection function.
 * The error message is safe to forward to the client verbatim.
 */
export function assertSqlApiQueryAllowed(sql: string): void {
  const match = stripLiteralsAndComments(sql).match(BLOCKED_PATTERN);
  if (match) {
    throw new Error(
      `Query references "${match[1]}", which is not available: ` +
        "server introspection functions (hostname, uptime, server identity) " +
        "are blocked on this endpoint.",
    );
  }
}
