import { expect, it } from "vitest";
import { Route } from "./_onboarding";

const beforeLoad = Route.options.beforeLoad as unknown as (args: {
  context: {
    session: {
      user: { id: string };
      session: { activeOrganizationId: string | null };
    } | null;
  };
  location: { href: string };
}) => unknown;

it("requires a session while preserving the onboarding destination through sign-in", () => {
  try {
    beforeLoad({
      context: { session: null },
      location: { href: "/create-organization?returnTo=%2Flogs" },
    });
    expect.fail("Expected a sign-in redirect");
  } catch (cause) {
    expect(cause).toMatchObject({
      options: {
        to: "/auth/sign-in",
        search: { redirect: "/create-organization?returnTo=%2Flogs" },
      },
    });
  }
});

it("admits signed-in users without an active organization", () => {
  const session = {
    user: { id: "new-user" },
    session: { activeOrganizationId: null },
  };
  expect(
    beforeLoad({
      context: { session },
      location: { href: "/choose-organization" },
    }),
  ).toEqual({ session });
});
