import { beforeEach, expect, it, vi } from "vitest";
import { createAlertingSilence } from "./server";

const mocks = vi.hoisted(() => ({ createSilence: vi.fn() }));

vi.mock("./repository", () => ({ createSilence: mocks.createSilence }));

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
