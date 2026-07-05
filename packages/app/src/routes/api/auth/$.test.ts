import { describe, expect, it } from "vite-plus/test";
import { Route } from "./$";

type GetHandler = (args: { request: Request }) => Response | Promise<Response>;

function getGetHandler() {
  const routeOptions = Route.options as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) {
    throw new Error("Missing GET handler for auth route.");
  }
  return handler;
}

describe("/api/auth/$ route", () => {
  it("redirects Better Auth error pages to the custom auth error route", async () => {
    const handler = getGetHandler();

    const response = await handler({
      request: new Request("http://localhost:5173/api/auth/error?error=email_doesn%27t_match"),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/auth/error?error=email_doesn%27t_match",
    );
  });
});
