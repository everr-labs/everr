// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { decryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import {
  createChannel,
  deleteChannel,
  listChannels,
  updateChannel,
} from "@/data/alerting/delivery/repository";
import {
  createSilence,
  expireSilence,
  listSilences,
} from "@/data/alerting/silences/repository";
import { listResources } from "@/data/as-code/resource-admin.server";
import { alertChannels } from "@/db/schema";
import {
  insertPreview,
  insertRule,
  TEST_ACTOR,
  TEST_ORG,
} from "./testing/fixtures";
import { useAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/test-clickhouse"));

const harness = useAlertingHarness();

const scope = { organizationId: TEST_ORG, actor: TEST_ACTOR };

/** A page big enough that these cases never straddle one. */
const PAGE = { limit: 50, offset: 0 };

describe("the alert rules the resource list reports", () => {
  it("lists a stored rule under its project and slug", async () => {
    await insertRule(harness().db, { slug: "checkout-latency" });

    const resources = await listResources(TEST_ORG, { kind: "alert" });

    expect(resources).toEqual([
      expect.objectContaining({
        kind: "alert",
        project: "default",
        slug: "checkout-latency",
        repoid: "repo_test",
      }),
    ]);
    expect(resources[0]?.updatedAt).toEqual(expect.any(String));
  });

  it("keeps a preview copy out of the live list", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, { slug: "live-only" });
    await insertRule(harness().db, {
      slug: "live-only",
      previewId: preview?.id,
    });

    const resources = await listResources(TEST_ORG, { kind: "alert" });

    expect(resources).toHaveLength(1);
  });

  it("narrows to the rules one repository owns", async () => {
    await insertRule(harness().db, { slug: "ours" });

    expect(
      await listResources(TEST_ORG, { kind: "alert", repoid: "repo_test" }),
    ).toHaveLength(1);
    expect(
      await listResources(TEST_ORG, { kind: "alert", repoid: "other_repo" }),
    ).toHaveLength(0);
  });

  it("reports nothing for an organization with no rules", async () => {
    expect(await listResources("org_other", { kind: "alert" })).toEqual([]);
  });
});

describe("the silences the CLI manages", () => {
  const window = {
    starts_at: "2026-08-20T09:00:00.000Z",
    ends_at: "2026-08-20T11:00:00.000Z",
  };

  it("lists a silence attributed to whoever created it", async () => {
    await createSilence(scope, {
      ...window,
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
      comment: "deploy window",
    });

    const silences = await listSilences(TEST_ORG, PAGE);

    expect(silences).toHaveLength(1);
    expect(silences[0]).toEqual(
      expect.objectContaining({
        author: TEST_ACTOR.display,
        comment: "deploy window",
        canceled_at: null,
      }),
    );
    expect(silences[0]?.matchers).toEqual([
      { label: "service", op: "eq", value: "checkout" },
    ]);
  });

  it("keeps an expired silence listed, with its window closed", async () => {
    harness().setNow(new Date("2026-08-20T10:00:00.000Z"));
    const silence = await createSilence(scope, {
      ...window,
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });

    expect(await expireSilence(scope, silence.id)).toEqual({ expired: true });

    const [listed] = await listSilences(TEST_ORG, PAGE);
    expect(listed?.canceled_at).not.toBeNull();
    expect(new Date(listed?.ends_at ?? "")).toEqual(
      new Date("2026-08-20T10:00:00.000Z"),
    );
  });

  it("finds the silences whose window overlapped the one asked about", async () => {
    await createSilence(scope, {
      starts_at: "2026-08-20T08:00:00.000Z",
      ends_at: "2026-08-20T10:00:00.000Z",
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });
    const overlapping = async (from: string, to: string) =>
      (
        await listSilences(TEST_ORG, {
          ...PAGE,
          from: new Date(from),
          to: new Date(to),
        })
      ).length;

    // Straddling either edge, and contained within, all overlap.
    expect(
      await overlapping("2026-08-20T07:00:00Z", "2026-08-20T09:00:00Z"),
    ).toBe(1);
    expect(
      await overlapping("2026-08-20T09:00:00Z", "2026-08-20T11:00:00Z"),
    ).toBe(1);
    expect(
      await overlapping("2026-08-20T09:00:00Z", "2026-08-20T09:00:00Z"),
    ).toBe(1);

    // Half-open at both ends: touching an edge is not covering it.
    expect(
      await overlapping("2026-08-20T10:00:00Z", "2026-08-20T11:00:00Z"),
    ).toBe(0);
    expect(
      await overlapping("2026-08-20T06:00:00Z", "2026-08-20T08:00:00Z"),
    ).toBe(0);
    expect(
      await overlapping("2026-08-20T11:00:00Z", "2026-08-20T12:00:00Z"),
    ).toBe(0);
  });

  it("takes each bound on its own", async () => {
    await createSilence(scope, {
      starts_at: "2026-08-20T08:00:00.000Z",
      ends_at: "2026-08-20T10:00:00.000Z",
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });

    // `from` alone: had not closed yet by then.
    expect(
      await listSilences(TEST_ORG, {
        ...PAGE,
        from: new Date("2026-08-20T09:00:00Z"),
      }),
    ).toHaveLength(1);
    expect(
      await listSilences(TEST_ORG, {
        ...PAGE,
        from: new Date("2026-08-20T11:00:00Z"),
      }),
    ).toHaveLength(0);

    // `to` alone: had already started by then.
    expect(
      await listSilences(TEST_ORG, {
        ...PAGE,
        to: new Date("2026-08-20T09:00:00Z"),
      }),
    ).toHaveLength(1);
    expect(
      await listSilences(TEST_ORG, {
        ...PAGE,
        to: new Date("2026-08-20T07:00:00Z"),
      }),
    ).toHaveLength(0);
  });

  it("returns the page it was asked for, newest first", async () => {
    // Distinct creation stamps: the harness freezes the clock the database
    // reads, so three silences created in one instant would have no order to
    // sort by and the assertion below would pass or fail at random.
    for (const service of ["first", "second", "third"]) {
      await createSilence(scope, {
        ...window,
        matchers: [{ label: "service", op: "eq", value: service }],
      });
      harness().advance(1000);
    }

    const page = await listSilences(TEST_ORG, { limit: 1, offset: 1 });

    expect(page).toHaveLength(1);
    expect(page[0]?.matchers).toEqual([
      { label: "service", op: "eq", value: "second" },
    ]);
  });

  it("stamps the author from the session, not from the input", async () => {
    const silence = await createSilence(scope, {
      ...window,
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
      author: "somebody-else",
    } as never);

    expect(silence.author).toBe(TEST_ACTOR.display);
  });

  it("refuses a silence that selects everything", async () => {
    await expect(
      createSilence(scope, { ...window, matchers: [] }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });
  });

  it("refuses an id that is not a silence id", async () => {
    await expect(expireSilence(scope, "not-a-uuid")).rejects.toMatchObject({
      status: 422,
      code: "validation",
    });
  });

  it("refuses a window that ends before it starts", async () => {
    await expect(
      createSilence(scope, {
        starts_at: window.ends_at,
        ends_at: window.starts_at,
        matchers: [{ label: "service", op: "eq", value: "checkout" }],
      }),
    ).rejects.toThrow(/after starts_at/);
  });
});

describe("the delivery channels the CLI manages", () => {
  const slack = { type: "slack", url: "https://203.0.113.10/slack" } as const;

  /** The org's one channel config, decrypted, as delivery would read it. */
  async function storedConfig() {
    const [row] = await harness().db.select().from(alertChannels);
    if (!row) throw new Error("no channel stored");
    return decryptChannelConfig(
      row.organizationId,
      row.id,
      row.encryptedConfig,
    );
  }

  it("never hands a stored secret back", async () => {
    await createChannel(scope, { name: "oncall", config: slack });

    const [channel] = await listChannels(TEST_ORG);

    expect(channel).toEqual(
      expect.objectContaining({
        name: "oncall",
        config: { type: "slack", url: "***" },
      }),
    );
  });

  it("keeps the secret through an edit that only renames", async () => {
    await createChannel(scope, { name: "oncall", config: slack });

    // No config at all: a rename says nothing about the credential, so the
    // caller never has to read one back to leave it alone.
    await updateChannel(scope, "oncall", { name: "primary-oncall" });

    const [channel] = await listChannels(TEST_ORG);
    expect(channel?.name).toBe("primary-oncall");
    // Read through the encryption rather than through the API: a channel
    // holding the literal "***" delivers nowhere, and a redacted read cannot
    // tell that apart from the working URL.
    expect(await storedConfig()).toEqual(slack);
  });

  it("keeps a same-type secret omitted from a config edit", async () => {
    await createChannel(scope, {
      name: "oncall",
      config: {
        type: "telegram",
        bot_token: "stored-token",
        chat_ids: ["old-chat"],
      },
    });

    await updateChannel(scope, "oncall", {
      config: { type: "telegram", chat_ids: ["new-chat"] },
    });

    expect(await storedConfig()).toEqual({
      type: "telegram",
      bot_token: "stored-token",
      chat_ids: ["new-chat"],
    });
  });

  it("replaces the secret when an edit supplies one", async () => {
    await createChannel(scope, { name: "oncall", config: slack });

    await updateChannel(scope, "oncall", {
      config: { type: "slack", url: "https://203.0.113.11/slack" },
    });

    const [channel] = await listChannels(TEST_ORG);
    expect(channel?.config).toEqual({ type: "slack", url: "***" });
    expect(await storedConfig()).toEqual({
      type: "slack",
      url: "https://203.0.113.11/slack",
    });
  });

  it("refuses a blank name, which no rule could address", async () => {
    await expect(
      createChannel(scope, { name: "   ", config: slack }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });
  });

  it("refuses a config whose type is not a transport", async () => {
    await expect(
      createChannel(scope, {
        name: "oncall",
        config: { type: "carrier-pigeon", url: "https://203.0.113.10/x" },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });
  });

  it("requires a secret for a new channel and after a type change", async () => {
    await expect(
      createChannel(scope, { name: "oncall", config: { type: "slack" } }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });

    await createChannel(scope, { name: "oncall", config: slack });
    await expect(
      updateChannel(scope, "oncall", {
        config: { type: "telegram", chat_ids: ["chat"] },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });
  });

  it("refuses the read-side redaction marker on writes", async () => {
    await expect(
      createChannel(scope, {
        name: "oncall",
        config: { type: "telegram", bot_token: "***", chat_ids: ["chat"] },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation" });
  });

  it("refuses a name another channel already has", async () => {
    await createChannel(scope, { name: "oncall", config: slack });

    await expect(
      createChannel(scope, { name: "oncall", config: slack }),
    ).rejects.toThrow(/conflicts/);
  });

  it("refuses to update a channel that does not exist", async () => {
    await expect(
      updateChannel(scope, "nope", { config: slack }),
    ).rejects.toThrow(/not found/);
  });

  it("deletes a channel nothing is still sending to", async () => {
    await createChannel(scope, { name: "oncall", config: slack });

    expect(await deleteChannel(scope, "oncall")).toEqual({ deleted: true });
    expect(await listChannels(TEST_ORG)).toEqual([]);
  });

  it("makes the first channel the organization's default destination", async () => {
    const first = await createChannel(scope, { name: "oncall", config: slack });
    await createChannel(scope, { name: "backup", config: slack });

    const rows = await harness().db.execute(
      `SELECT channel_id FROM alert_default_channels WHERE organization_id = '${TEST_ORG}'`,
    );

    expect(rows.rows).toEqual([{ channel_id: first.id }]);
  });
});
