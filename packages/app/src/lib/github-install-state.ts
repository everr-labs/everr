import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

type InstallStatePayload = {
  exp: number;
  organizationId: string;
  userId: string;
};

const stateTTLSeconds = 10 * 60;

function sign(input: string): string {
  return createHmac("sha256", env.GITHUB_APP_STATE_SECRET)
    .update(input)
    .digest("base64url");
}

export function createInstallState(input: {
  organizationId: string;
  userId: string;
  now?: number;
}): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: InstallStatePayload = {
    organizationId: input.organizationId,
    userId: input.userId,
    exp: now + stateTTLSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseInstallState(
  state: string,
  now = Math.floor(Date.now() / 1000),
): InstallStatePayload {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid state format.");
  }

  const expectedSignature = sign(encodedPayload);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expectedSignature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid state signature.");
  }

  let payload: InstallStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as InstallStatePayload;
  } catch {
    throw new Error("Invalid state payload.");
  }

  if (
    !payload.organizationId ||
    !payload.userId ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid state payload.");
  }

  if (payload.exp < now) {
    throw new Error("State has expired.");
  }

  return payload;
}
