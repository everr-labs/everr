import { describe, expect, it } from "vitest";
import {
  alertingMutationScope,
  parseAlertingPrincipal,
  SYSTEM_ACTOR,
} from "./session";

describe("parseAlertingPrincipal", () => {
  it("reads a user principal", () => {
    expect(parseAlertingPrincipal("user:u1")).toEqual({
      kind: "user",
      id: "u1",
      display: "user:u1",
    });
  });

  it("reads an API key principal", () => {
    expect(parseAlertingPrincipal("apikey:k1")).toEqual({
      kind: "apikey",
      id: "k1",
      display: "apikey:k1",
    });
  });

  it("throws rather than attribute a malformed principal", () => {
    for (const malformed of ["", "u1", "user", "user:", ":u1", "robot:r1"]) {
      expect(() => parseAlertingPrincipal(malformed)).toThrow(
        /Unrecognized principal id/,
      );
    }
  });
});

describe("alertingMutationScope", () => {
  it("names the session user, preferring the display name", () => {
    expect(
      alertingMutationScope({
        session: { activeOrganizationId: "org_1" },
        user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
      }),
    ).toEqual({
      organizationId: "org_1",
      actor: { kind: "user", id: "u1", display: "Ada Lovelace" },
    });
  });

  it("falls back to the email, then to the user id", () => {
    const scopeFor = (user: { id: string; name?: string; email?: string }) =>
      alertingMutationScope({
        session: { activeOrganizationId: "org_1" },
        user,
      });

    expect(scopeFor({ id: "u1", email: "ada@example.com" }).actor.display).toBe(
      "ada@example.com",
    );
    expect(scopeFor({ id: "u1" }).actor.display).toBe("u1");
  });

  it("parses the principal on the apply path, where user.id is not a user id", () => {
    expect(
      alertingMutationScope({
        session: { activeOrganizationId: "org_1" },
        user: { id: "apikey:k1" },
        principalId: "apikey:k1",
      }).actor,
    ).toEqual({ kind: "apikey", id: "k1", display: "apikey:k1" });
  });
});

it("gives unattended changes an actor with no principal id", () => {
  expect(SYSTEM_ACTOR).toEqual({ kind: "system", id: "", display: "system" });
});
