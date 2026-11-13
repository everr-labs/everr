import { describe, expect, it } from "vite-plus/test";
import { Route } from "../routes/everr-app/$";

type GetHandler = (args: { request: Request }) => Promise<Response>;

function getHandler() {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;

  if (!handler) {
    throw new Error("GET handler is not registered.");
  }

  return handler;
}

// Which paths are allowed is covered by cli-release-redirect.test.ts; this only
// checks that the route answers with that decision.
describe("/everr-app/$", () => {
  it("redirects CLI release files", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/release-metadata.json"),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/everr-app/release-metadata.json");
  });

  it("returns 404 for files it does not redirect", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/%2E%2E/secret"),
    });

    expect(response.status).toBe(404);
  });
});
