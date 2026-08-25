import { beforeEach, expect, it, vi } from "vitest";
import { createAlertingSilence, expireAlertingSilence } from "./server";

const mocks = vi.hoisted(() => ({
  createSilence: vi.fn(),
  expireSilence: vi.fn(),
}));

vi.mock("./repository", () => ({
  createSilence: mocks.createSilence,
  expireSilence: mocks.expireSilence,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const input = {
  matchers: [{ label: "team", op: "eq" as const, value: "pay" }],
  starts_at: "2026-07-01T11:00:00Z",
  ends_at: "2026-07-01T13:00:00Z",
  comment: "deploying",
};

it("stamps the authenticated session user as the actor", async () => {
  await createAlertingSilence({ data: input });

  expect(mocks.createSilence).toHaveBeenCalledWith(
    {
      organizationId: "test_org",
      actor: { kind: "user", id: "test_user", display: "Test User" },
    },
    expect.objectContaining({ comment: "deploying" }),
  );
});

it("ignores an author sent by the client", async () => {
  await createAlertingSilence({
    // The input schema has no author, so a caller that sends one is claiming
    // authorship it cannot have.
    data: { ...input, author: "someone else" } as typeof input,
  });

  expect(mocks.createSilence.mock.calls[0]?.[1]).not.toHaveProperty("author");
});

// The column is a uuid, so a malformed id reaches Postgres as invalid input
// syntax and comes back a 500. It is bad request data: reject it at the edge.
it("rejects a silence id that is not a uuid before reading the database", async () => {
  await expect(
    expireAlertingSilence({ data: { id: "not-a-uuid" } }),
  ).rejects.toThrow();

  expect(mocks.expireSilence).not.toHaveBeenCalled();
});
