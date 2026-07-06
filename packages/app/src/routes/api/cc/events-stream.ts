import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import { ccAuthHeaders } from "@/lib/clickety-clack.server";
import { createSSEStream } from "@/lib/sse";

// Server-side proxy for clickety-clack's SSE event stream. The browser cannot
// send the trusted `X-CC-Tenant` header, so everr opens the upstream stream here
// (tenant from the session) and re-emits each event through the app's own
// `createSSEStream` helper — the same mechanism everr's native SSE route uses, so
// it streams correctly through the Nitro/vite dev server (piping undici's raw
// upstream body directly does not). Aborting the browser connection aborts
// upstream via `request.signal`.
export const Route = createFileRoute("/api/cc/events-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const orgId = session?.session?.activeOrganizationId;
        if (!orgId) {
          return Response.json({ error: "Unauthenticated" }, { status: 401 });
        }

        const upstream = await fetch(
          `${env.CLICKETY_CLACK_BASE_URL}/v1/events/stream`,
          {
            method: "GET",
            headers: {
              "X-CC-Tenant": orgId,
              accept: "text/event-stream",
              ...ccAuthHeaders(),
            },
            signal: request.signal,
          },
        );

        if (!upstream.ok || !upstream.body) {
          return Response.json(
            { error: `clickety-clack stream unavailable (${upstream.status})` },
            { status: 502 },
          );
        }

        const sse = createSSEStream(request);
        // Narrowed above; capture so the closure below keeps the non-null type.
        const upstreamBody = upstream.body;

        // Pump the upstream CC stream: parse `data:` frames and forward the JSON
        // payload to the client. Runs until upstream ends or the client aborts.
        void (async () => {
          const reader = upstreamBody.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let sep: number;
              // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic frame split
              while ((sep = buf.indexOf("\n\n")) !== -1) {
                const frame = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                for (const line of frame.split("\n")) {
                  const m = /^data:\s?(.*)$/.exec(line);
                  if (!m) continue;
                  try {
                    sse.sendEvent(JSON.parse(m[1]));
                  } catch {
                    // non-JSON keep-alive/comment frame — ignore
                  }
                }
              }
            }
          } catch {
            // upstream aborted/errored — fall through to close
          } finally {
            sse.close();
          }
        })();

        return sse.response();
      },
    },
  },
});
