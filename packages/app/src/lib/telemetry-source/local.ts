import type { SqlClient } from "./types";

/**
 * The collector's SQL listener. Debug builds use 54320 and release builds 54420
 * (crates/everr-core/src/build.rs), and the app cannot know which one a given
 * machine is running, so both are candidates and the probe picks whichever
 * answers.
 */
export const LOCAL_SQL_ORIGINS = [
  "http://127.0.0.1:54320",
  "http://127.0.0.1:54420",
] as const;

/**
 * Values travel as `param_<name>` query arguments holding JSON, which is what
 * the collector's substituteParams expects: a String wants `"foo"`, an integer
 * wants a bare `42`, and an Array(String) wants `["a","b"]`. JSON.stringify
 * produces exactly those three forms.
 */
function paramsToQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(`param_${name}`, JSON.stringify(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** The collector reports failures as `{"error": "..."}` with a JSON body. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not the documented shape; fall through to the status.
  }
  return `local collector returned ${response.status}`;
}

function parseNdjson<Row>(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as Row);
  }
  return rows;
}

/**
 * Reads straight from the collector on this machine, with no app server in the
 * path. That is the whole point of the local source: the browser holds the SQL
 * already, and the data never leaves the machine in order to be displayed.
 *
 * There is no authentication because the listener is bound to loopback and the
 * collector holds a single tenant's data by construction. What keeps other
 * pages out is the origin allowlist the collector enforces, not a credential.
 */
export function createLocalSqlClient(origin: string): SqlClient {
  return {
    async execute<Row>(sql: string, params: Record<string, unknown>) {
      const url = `${origin}/sql${paramsToQueryString(params)}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          // A CORS-safelisted content type: the dev origin then needs no
          // preflight at all. The hosted origin still gets one, because a public
          // page reaching a private address always does.
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: sql,
        });
      } catch (cause) {
        throw new Error(
          `Could not reach the local collector at ${origin}. Is it running?`,
          { cause },
        );
      }

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      return parseNdjson<Row>(await response.text());
    },
  };
}
