import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken } from "./service-account-credentials";

// The rows the token-to-membership join returns. One row is a service
// account with the single membership the guards hold it to; two rows are
// what a membership written by hand would look like.
let joinedRows: Array<{
  id: string;
  expiresAt: Date;
  organizationId: string;
  user: { id: string };
}> = [];

vi.mock("@/db/client", () => {
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder passthrough mock has no fixed shape.
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => joinedRows,
  };
  return { db: { select: () => chain } };
});

function membership(organizationId: string) {
  return {
    id: "token-1",
    expiresAt: new Date(Date.now() + 3600 * 1000),
    organizationId,
    user: { id: "user-1" },
  };
}

beforeEach(() => {
  joinedRows = [];
});

describe("findLiveToken", () => {
  it("resolves the organization of a service account that holds one membership", async () => {
    joinedRows = [membership("org-1")];
    const { findLiveToken } = await import("./service-account-store");

    const row = await findLiveToken(generateToken().value);

    expect(row?.organizationId).toBe("org-1");
  });

  it("refuses to resolve a service account that holds two memberships", async () => {
    // Which organization the agent acts in would come down to row order, and
    // acting in the wrong tenant leaves no trace anyone would look for.
    joinedRows = [membership("org-1"), membership("org-2")];
    const { findLiveToken } = await import("./service-account-store");

    expect(await findLiveToken(generateToken().value)).toBeNull();
  });
});
