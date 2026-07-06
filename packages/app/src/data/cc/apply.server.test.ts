import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  listReceivers: vi.fn(),
  upsertReceiver: vi.fn(),
  deleteReceiver: vi.fn(),
  listRoutes: vi.fn(),
}));

import { ApplyValidationError } from "@/data/as-code/errors";
import type { DbExecutor } from "@/db/client";
import { applyCcReceiverSpecs } from "./apply.server";
import * as client from "./client";

// The CC receiver reconciler talks to CC over HTTP and never touches Postgres,
// so the Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

beforeEach(() => {
  vi.clearAllMocks();
});

const entry = (resource: unknown) => ({ path: "r.yaml", resource });

const receiverEntry = (name: string) =>
  entry({
    kind: "CCReceiver",
    metadata: { name },
    spec: { channel: { type: "slack", url: "u" } },
  });

it("stamps repoid + as-code ownership on every receiver upsert", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [receiverEntry("keep"), receiverEntry("fresh")],
  });
  expect(res.updated).toEqual(["keep"]);
  expect(res.created).toEqual(["fresh"]);
  const bodies = (client.upsertReceiver as ReturnType<typeof vi.fn>).mock.calls;
  for (const [, body] of bodies) {
    expect(body.annotations).toEqual({
      "everr.repoid": "repo1",
      "everr.managed": "as-code",
    });
  }
});

it("prunes an as-code receiver of this repo that config no longer declares", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [receiverEntry("keep")],
  });
  expect(client.deleteReceiver).toHaveBeenCalledWith("o", "gone");
  expect(client.deleteReceiver).toHaveBeenCalledTimes(1);
  expect(res.deleted).toEqual(["gone"]);
});

it("never prunes unmarked receivers, other repos', or the org defaults", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    // No ownership marker (created out-of-band / by an older apply).
    { name: "unmarked" },
    // Owned by a different repo.
    {
      name: "other-repo",
      annotations: { "everr.repoid": "repo2", "everr.managed": "as-code" },
    },
    // Settings-owned org default — even if hand-stamped, name-guarded.
    {
      name: "everr-default-slack",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [],
  });
  expect(client.deleteReceiver).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
});

it("fails (naming the route ids) instead of deleting a route-referenced receiver", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "route-a", receiver: "gone" },
    { id: "route-b", receiver: "gone" },
    { id: "route-c", receiver: "someone-else" },
  ]);
  try {
    await applyCcReceiverSpecs({
      namespace: { orgId: "o", repoid: "repo1", kind: "live" },
      db,
      resources: [],
    });
    expect.fail("expected the route reference to fail the apply");
  } catch (error) {
    expect(error).toBeInstanceOf(ApplyValidationError);
    expect((error as Error).message).toMatch(/route-a/);
    expect((error as Error).message).toMatch(/route-b/);
    expect((error as Error).message).toContain('"gone"');
  }
  expect(client.deleteReceiver).not.toHaveBeenCalled();
});

it("dryRun reports would-be receiver deletions without deleting or upserting", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    dryRun: true,
    resources: [receiverEntry("keep")],
  });
  expect(res.deleted).toEqual(["gone"]);
  expect(res.updated).toEqual(["keep"]);
  expect(client.deleteReceiver).not.toHaveBeenCalled();
  expect(client.upsertReceiver).not.toHaveBeenCalled();
});
