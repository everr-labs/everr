import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { accessTokens, cliDeviceAuthorizations } from "@/db/schema";
import {
  generateAccessToken,
  getAccessTokenPrefix,
  hashAccessToken,
} from "@/lib/access-token";

export const DEVICE_CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type DeviceStartResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult =
  | { status: "authorization_pending" }
  | { status: "slow_down" }
  | { status: "expired_token" }
  | { status: "access_denied" }
  | {
      status: "ok";
      access_token: string;
      token_type: "Bearer";
      expires_in: number;
    };

function now(): Date {
  return new Date();
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function hashDeviceCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateDeviceCode(): string {
  return toBase64Url(randomBytes(32));
}

function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function equalUserCode(left: string, right: string): boolean {
  const a = Buffer.from(left.toUpperCase());
  const b = Buffer.from(right.toUpperCase());
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

async function findByUserCode(userCode: string) {
  const rows = await db
    .select()
    .from(cliDeviceAuthorizations)
    .where(eq(cliDeviceAuthorizations.status, "pending"));

  for (const row of rows) {
    if (equalUserCode(row.userCode, userCode)) {
      return row;
    }
  }

  return null;
}

export async function startDeviceAuthorization(
  origin: string,
): Promise<DeviceStartResponse> {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = new Date(now().getTime() + DEVICE_CODE_TTL_SECONDS * 1000);

  await db.insert(cliDeviceAuthorizations).values({
    deviceCodeHash: hashDeviceCode(deviceCode),
    userCode,
    expiresAt,
    pollIntervalSeconds: 5,
  });

  const verificationUri = `${origin}/cli/device`;
  const encodedCode = encodeURIComponent(userCode);

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodedCode}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: 5,
  };
}

export async function approveDeviceAuthorization(input: {
  userCode: string;
  approvedByUserId: string;
  approvedForOrganizationId: string;
  approvedForTenantId: number;
}): Promise<boolean> {
  const auth = await findByUserCode(input.userCode.trim());
  if (!auth) {
    return false;
  }

  if (auth.expiresAt <= now()) {
    await db
      .update(cliDeviceAuthorizations)
      .set({ status: "expired", updatedAt: now() })
      .where(eq(cliDeviceAuthorizations.id, auth.id));
    return false;
  }

  await db
    .update(cliDeviceAuthorizations)
    .set({
      status: "approved",
      approvedByUserId: input.approvedByUserId,
      approvedForOrganizationId: input.approvedForOrganizationId,
      approvedForTenantId: input.approvedForTenantId,
      updatedAt: now(),
    })
    .where(eq(cliDeviceAuthorizations.id, auth.id));

  return true;
}

export async function denyDeviceAuthorization(
  userCode: string,
): Promise<boolean> {
  const auth = await findByUserCode(userCode.trim());
  if (!auth) {
    return false;
  }

  if (auth.expiresAt <= now()) {
    await db
      .update(cliDeviceAuthorizations)
      .set({ status: "expired", updatedAt: now() })
      .where(eq(cliDeviceAuthorizations.id, auth.id));
    return false;
  }

  await db
    .update(cliDeviceAuthorizations)
    .set({
      status: "denied",
      updatedAt: now(),
    })
    .where(eq(cliDeviceAuthorizations.id, auth.id));

  return true;
}

export async function pollDeviceAuthorization(
  deviceCode: string,
): Promise<DevicePollResult> {
  const codeHash = hashDeviceCode(deviceCode.trim());
  const [auth] = await db
    .select()
    .from(cliDeviceAuthorizations)
    .where(eq(cliDeviceAuthorizations.deviceCodeHash, codeHash))
    .limit(1);

  if (!auth) {
    return { status: "expired_token" };
  }

  const current = now();
  if (auth.expiresAt <= current || auth.status === "expired") {
    if (auth.status !== "expired") {
      await db
        .update(cliDeviceAuthorizations)
        .set({ status: "expired", updatedAt: current })
        .where(eq(cliDeviceAuthorizations.id, auth.id));
    }
    return { status: "expired_token" };
  }

  if (auth.status === "denied") {
    return { status: "access_denied" };
  }

  if (auth.status === "consumed") {
    return { status: "expired_token" };
  }

  if (auth.status === "pending") {
    if (auth.lastPolledAt) {
      const elapsedMs = current.getTime() - auth.lastPolledAt.getTime();
      if (elapsedMs < auth.pollIntervalSeconds * 1000) {
        return { status: "slow_down" };
      }
    }

    await db
      .update(cliDeviceAuthorizations)
      .set({ lastPolledAt: current, updatedAt: current })
      .where(eq(cliDeviceAuthorizations.id, auth.id));

    return { status: "authorization_pending" };
  }

  if (auth.status !== "approved") {
    return { status: "access_denied" };
  }

  const approvedByUserId = auth.approvedByUserId;
  const approvedForOrganizationId = auth.approvedForOrganizationId;
  const approvedForTenantId = auth.approvedForTenantId;
  if (
    !approvedByUserId ||
    !approvedForOrganizationId ||
    approvedForTenantId == null
  ) {
    return { status: "access_denied" };
  }

  const token = generateAccessToken();
  const tokenHash = hashAccessToken(token);
  const tokenPrefix = getAccessTokenPrefix(token);
  const expiresAt = new Date(
    current.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  );

  await db.transaction(async (tx) => {
    await tx.insert(accessTokens).values({
      organizationId: approvedForOrganizationId,
      userId: approvedByUserId,
      name: `cli-device-${crypto.randomUUID().slice(0, 8)}`,
      tokenHash,
      tokenPrefix,
      expiresAt,
    });

    await tx
      .update(cliDeviceAuthorizations)
      .set({ status: "consumed", updatedAt: current })
      .where(
        and(
          eq(cliDeviceAuthorizations.id, auth.id),
          eq(cliDeviceAuthorizations.status, "approved"),
        ),
      );
  });

  return {
    status: "ok",
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function expireStaleDeviceAuthorizations(): Promise<void> {
  const current = now();
  await db
    .update(cliDeviceAuthorizations)
    .set({ status: "expired", updatedAt: current })
    .where(
      and(
        eq(cliDeviceAuthorizations.status, "pending"),
        lt(cliDeviceAuthorizations.expiresAt, current),
      ),
    );
}
