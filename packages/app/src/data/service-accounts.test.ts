import { beforeEach, describe, expect, it, vi } from "vitest";
import { member, serviceAccount } from "@/db/schema";
import { SERVICE_ACCOUNT_ROLES, serviceAccountEmail } from "./service-accounts";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(async (data: Record<string, unknown>) => ({
    id: "user-1",
    ...data,
  })),
  deleteUser: vi.fn(async () => {}),
  getActiveMemberRole: vi.fn(async () => ({ role: "admin" })),
}));

vi.mock("@/lib/auth.server", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
      },
    }),
    api: {
      getActiveMemberRole: mocks.getActiveMemberRole,
    },
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("drizzle-orm/pg-core", () => ({
  alias: (table: unknown, name: string) => ({ ...(table as object), name }),
}));

// Each column is its own object so a condition built from it says which
// column it was built from. `name` stays a string on every table because
// the executor below keys its recording off it.
vi.mock("@/db/schema", () => ({
  member: {
    name: "member",
    userId: { column: "member.user_id" },
    organizationId: { column: "member.organization_id" },
    role: { column: "member.role" },
  },
  serviceAccount: {
    name: "service_account",
    id: { column: "service_account.id" },
    userId: { column: "service_account.user_id" },
    createdAt: { column: "service_account.created_at" },
    lastUsedAt: { column: "service_account.last_used_at" },
    createdByUserId: { column: "service_account.created_by_user_id" },
  },
  serviceAccountSecret: {
    name: "service_account_secret",
    id: { column: "service_account_secret.id" },
    serviceAccountId: { column: "service_account_secret.service_account_id" },
    start: { column: "service_account_secret.start" },
    createdAt: { column: "service_account_secret.created_at" },
    lastUsedAt: { column: "service_account_secret.last_used_at" },
    revokedAt: { column: "service_account_secret.revoked_at" },
  },
  serviceAccountToken: {
    name: "service_account_token",
    serviceAccountSecretId: {
      column: "service_account_token.service_account_secret_id",
    },
  },
  user: {
    name: "user",
    id: { column: "user.id" },
  },
}));

// insertedTables(), revokedSecretIds(), and deletedTokenSecretIds() are the
// facts the tests need out of the mocked db: which tables received an
// insert, which secrets got an explicit revoke, and which secret id a token
// delete targeted. Everything else about the chain is a passthrough with no
// behavior of its own.
const insertedRows: string[] = [];
const revokedIds: string[] = [];
const deletedTokenSecretIds: string[] = [];
const joins: Array<{ table: unknown; condition: unknown }> = [];
const selectResult: Array<Record<string, unknown>> = [
  { id: "sa-1", userId: "user-1", serviceAccountId: "sa-1" },
];

function tableName(table: unknown): string {
  return (table as { name: string }).name;
}

function makeSelectChain() {
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder passthrough mock has no fixed shape.
  const chain: any = {
    from: () => chain,
    innerJoin: (table: unknown, condition: unknown) => {
      joins.push({ table, condition });
      return chain;
    },
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => selectResult,
    // biome-ignore lint/suspicious/noThenProperty: a query with no `limit` is awaited straight off the builder, which is exactly what a thenable stands in for.
    then: (resolve: (rows: unknown) => unknown) => resolve(selectResult),
  };
  return chain;
}

function makeExecutor() {
  return {
    insert: (table: unknown) => ({
      values: async () => {
        insertedRows.push(tableName(table));
      },
    }),
    select: () => makeSelectChain(),
    update: (table: unknown) => ({
      set: (values: { revokedAt?: unknown }) => ({
        where: async () => {
          if (
            tableName(table) === "service_account_secret" &&
            values.revokedAt
          ) {
            revokedIds.push("revoked");
          }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (condition: { right?: unknown }) => {
        if (tableName(table) === "service_account_token") {
          deletedTokenSecretIds.push(String(condition?.right));
        }
      },
    }),
  };
}

vi.mock("@/db/client", () => ({
  db: {
    ...makeExecutor(),
    transaction: async (fn: (tx: ReturnType<typeof makeExecutor>) => unknown) =>
      fn(makeExecutor()),
  },
}));

function insertedTables(): string[] {
  return [...insertedRows];
}

function revokedSecretIds(): string[] {
  return [...revokedIds];
}

function tokenDeletesForSecret(): string[] {
  return [...deletedTokenSecretIds];
}

// The membership join is the whole tenant boundary, so the tests below read
// back the condition each query joined `member` on.
function memberJoinConditions(): unknown[] {
  return joins
    .filter((join) => tableName(join.table) === "member")
    .map((join) => join.condition);
}

// The organization the authenticated server-function harness signs every
// call in with (src/test-setup.ts).
const CALLER_ORG = "test_org";

const scopedToCallerOrg = {
  type: "and",
  args: [
    { type: "eq", left: member.userId, right: serviceAccount.userId },
    { type: "eq", left: member.organizationId, right: CALLER_ORG },
  ],
};

beforeEach(() => {
  insertedRows.length = 0;
  revokedIds.length = 0;
  deletedTokenSecretIds.length = 0;
  joins.length = 0;
  mocks.getActiveMemberRole.mockResolvedValue({ role: "admin" });
});

describe("SERVICE_ACCOUNT_ROLES", () => {
  it("does not offer owner, which controls billing and deletion", () => {
    expect(SERVICE_ACCOUNT_ROLES).not.toContain("owner");
  });

  it("offers admin and member", () => {
    expect(SERVICE_ACCOUNT_ROLES).toEqual(["admin", "member"]);
  });
});

describe("serviceAccountEmail", () => {
  it("uses a domain that can never receive mail", () => {
    expect(serviceAccountEmail("abc")).toBe("abc@svc.everr.invalid");
  });
});

describe("createServiceAccount", () => {
  it("refuses owner, which controls billing and deletion", async () => {
    const { createServiceAccount } = await import("./service-accounts");

    await expect(
      createServiceAccount({ data: { name: "bot", role: "owner" } } as never),
    ).rejects.toThrow(/role/i);
  });

  it("marks the synthetic user as a service account", async () => {
    // The flag is what every guard reads, so the create path is the one
    // place that has to set it.
    const { createServiceAccount } = await import("./service-accounts");
    await createServiceAccount({
      data: { name: "bot", role: "member" },
    } as never);

    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ isServiceAccount: true }),
      expect.anything(),
    );
  });

  it("creates no account row, so the account cannot sign in with a password", async () => {
    // A password sign-in resolves through `account`. Creating none is the
    // guard, so assert the creation path never writes one.
    const { createServiceAccount } = await import("./service-accounts");
    await createServiceAccount({
      data: { name: "bot", role: "member" },
    } as never);

    // The three rows the creation path does write, asserted so the absence
    // above means "no account row", not "the transaction never ran".
    expect(insertedTables()).toEqual([
      "member",
      "service_account",
      "service_account_secret",
    ]);
    expect(insertedTables()).not.toContain("account");
  });
});

describe("rotateServiceAccountSecret", () => {
  it("leaves the previous secret usable until it is revoked", async () => {
    const { rotateServiceAccountSecret } = await import("./service-accounts");
    const second = await rotateServiceAccountSecret({
      data: { serviceAccountId: "sa-1" },
    } as never);

    expect(second.secret).toBeTruthy();
    expect(revokedSecretIds()).toEqual([]);
  });
});

describe("revokeServiceAccountSecret", () => {
  it("deletes only that secret's tokens, not the account's other secrets", async () => {
    const { revokeServiceAccountSecret } = await import("./service-accounts");

    await revokeServiceAccountSecret({
      data: { secretId: "secret-a" },
    } as never);

    // The delete must key off the secret the caller named, not off the
    // owning account: keying off the account would also drop tokens for
    // every other secret that account holds.
    expect(tokenDeletesForSecret()).toEqual(["secret-a"]);
  });
});

describe("tenant scoping", () => {
  it("reaches an existing account only through a membership in the caller's organization", async () => {
    // Without the organization half of this join, any admin could name any
    // account id and act on another tenant's service account.
    const { deleteServiceAccount } = await import("./service-accounts");

    await deleteServiceAccount({
      data: { serviceAccountId: "sa-1" },
    } as never);

    expect(memberJoinConditions()).toEqual([scopedToCallerOrg]);
  });

  it("scopes a secret's account lookup the same way", async () => {
    const { revokeServiceAccountSecret } = await import("./service-accounts");

    await revokeServiceAccountSecret({
      data: { secretId: "secret-a" },
    } as never);

    expect(memberJoinConditions()).toEqual([scopedToCallerOrg]);
  });

  it("lists accounts and their secrets only for the caller's organization", async () => {
    // Both queries carry the boundary on their own: the secrets query does
    // not inherit it from the accounts query.
    const { listServiceAccounts } = await import("./service-accounts");

    await listServiceAccounts();

    expect(memberJoinConditions()).toEqual([
      scopedToCallerOrg,
      scopedToCallerOrg,
    ]);
  });
});

describe("permission gate", () => {
  it("refuses a plain member on every service account operation", async () => {
    mocks.getActiveMemberRole.mockResolvedValue({ role: "member" });

    const {
      createServiceAccount,
      listServiceAccounts,
      rotateServiceAccountSecret,
      revokeServiceAccountSecret,
      deleteServiceAccount,
    } = await import("./service-accounts");

    await expect(
      createServiceAccount({
        data: { name: "bot", role: "member" },
      } as never),
    ).rejects.toThrow(/admin/i);
    await expect(listServiceAccounts()).rejects.toThrow(/admin/i);
    await expect(
      rotateServiceAccountSecret({
        data: { serviceAccountId: "sa-1" },
      } as never),
    ).rejects.toThrow(/admin/i);
    await expect(
      revokeServiceAccountSecret({
        data: { secretId: "secret-a" },
      } as never),
    ).rejects.toThrow(/admin/i);
    await expect(
      deleteServiceAccount({
        data: { serviceAccountId: "sa-1" },
      } as never),
    ).rejects.toThrow(/admin/i);
  });
});
