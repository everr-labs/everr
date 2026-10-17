import { describe, expect, it, vi } from "vitest";
import { getRouteHandler } from "./-test-utils";
import { Route } from "./me";

const configuration = vi.hoisted(() => ({
  endpoint: undefined as string | undefined,
}));
vi.mock("@composition/server", () => ({
  server: {
    getIngestEndpoint: () => configuration.endpoint,
  },
}));

type GetHandler = (args: {
  context: {
    session: { user: { id: string; email: string; name: string | null } };
    organization: { id: string; name: string };
  };
}) => Response;

describe("/api/cli/me", () => {
  it.each([
    {
      name: "Alice Smith",
      displayName: "Alice Smith",
      endpoint: "https://telemetry.example.test/otlp",
    },
    { name: null, displayName: "alice@example.com", endpoint: undefined },
  ])("returns the account identity with display name $displayName", ({
    name,
    displayName,
    endpoint,
  }) => {
    configuration.endpoint = endpoint;
    const response = getRouteHandler<GetHandler>(
      Route,
      "GET",
      "/api/cli/me",
    )({
      context: {
        session: {
          user: { id: "user-alice", email: "alice@example.com", name },
        },
        organization: { id: "org-active", name: "Active Organization" },
      },
    });

    expect(response.status).toBe(200);
    return expect(response.json()).resolves.toEqual({
      userId: "user-alice",
      organizationId: "org-active",
      email: "alice@example.com",
      name: displayName,
      organizationName: "Active Organization",
      ingestEndpoint: endpoint ?? null,
    });
  });
});
