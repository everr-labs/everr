import { describe, expect, it } from "vitest";
import { getRouteHandler } from "./-test-utils";
import { Route } from "./me";

type GetHandler = (args: {
  context: {
    session: { user: { email: string; name: string | null } };
    organization: { name: string };
  };
}) => Response;

describe("/api/cli/me", () => {
  it.each([
    { name: "Alice Smith", displayName: "Alice Smith" },
    { name: null, displayName: "alice@example.com" },
  ])("returns the account identity with display name $displayName", ({
    name,
    displayName,
  }) => {
    const response = getRouteHandler<GetHandler>(
      Route,
      "GET",
      "/api/cli/me",
    )({
      context: {
        session: { user: { email: "alice@example.com", name } },
        organization: { name: "Active Organization" },
      },
    });

    expect(response.status).toBe(200);
    return expect(response.json()).resolves.toEqual({
      email: "alice@example.com",
      name: displayName,
      organizationName: "Active Organization",
    });
  });
});
