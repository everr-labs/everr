import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memberships: [] as { organizationId: string }[],
  invitations: [] as { id: string }[],
  lock: Promise.resolve(),
}));

vi.mock("@/db/client", async () => {
  const { member, user } = await import("@/db/schema");
  return {
    db: {
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        let release: (() => void) | undefined;
        const tx = {
          execute: async () => {
            const previous = state.lock;
            state.lock = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
          },
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                limit: async () => {
                  if (table === member) return [...state.memberships];
                  if (table === user)
                    return [{ name: "Jane", email: "jane@example.com" }];
                  return [...state.invitations];
                },
              }),
            }),
          }),
        };
        try {
          return await run(tx);
        } finally {
          release?.();
        }
      },
    },
  };
});

import { ensureAutomaticOrganization } from "@/lib/auto-org.server";

beforeEach(() => {
  state.memberships = [];
  state.invitations = [];
  state.lock = Promise.resolve();
});

describe("automatic organization creation", () => {
  it("creates once and reuses the organization for overlapping sign-ins", async () => {
    const create = vi.fn(async () => {
      await Promise.resolve();
      const id = `org-${state.memberships.length + 1}`;
      state.memberships.push({ organizationId: id });
      return { id };
    });

    const organizations = await Promise.all([
      ensureAutomaticOrganization("user-1", create),
      ensureAutomaticOrganization("user-1", create),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(organizations).toEqual(["org-1", "org-1"]);
    expect(state.memberships).toHaveLength(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", plan: "hobby" }),
    );
  });

  it("preserves the organization chooser if several memberships appeared", async () => {
    state.memberships = [
      { organizationId: "org-1" },
      { organizationId: "org-2" },
    ];
    const create = vi.fn();
    expect(await ensureAutomaticOrganization("user-1", create)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create a personal organization for an invited user", async () => {
    state.invitations = [{ id: "invite-1" }];
    const create = vi.fn();
    expect(await ensureAutomaticOrganization("user-1", create)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("releases the lock when creation fails so a later sign-in can retry", async () => {
    await expect(
      ensureAutomaticOrganization("user-1", async () => {
        throw new Error("creation failed");
      }),
    ).rejects.toThrow("creation failed");
    expect(
      await ensureAutomaticOrganization("user-1", async () => ({
        id: "org-1",
      })),
    ).toBe("org-1");
  });
});
