import { describe, expect, it } from "vitest";
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

describe("/everr-app/$", () => {
  it("redirects known desktop release files", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/latest.json"),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/everr-app/latest.json",
    );
  });

  it("returns 404 for unknown files", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/debug.txt"),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for path traversal attempts", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/%2E%2E/secret"),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for malformed encoded paths", async () => {
    const response = await getHandler()({
      request: new Request("https://everr.dev/everr-app/%E0%A4%A"),
    });

    expect(response.status).toBe(404);
  });
});
