import { authClient } from "@/lib/auth-client";

export type DeviceActionResult = { ok: true } | { ok: false; message: string };

// better-auth requires a device code to be verified/claimed by the current
// session before it can be approved or denied, so both helpers run that
// two-step handshake. Centralized here so the device page and the onboarding
// "Authorize device" step don't reimplement the protocol.
// https://better-auth.com/docs/plugins/device-authorization
async function verifyDeviceCode(userCode: string): Promise<DeviceActionResult> {
  const verification = await authClient.device({
    query: { user_code: userCode },
  });
  if (verification.error) {
    return {
      ok: false,
      message:
        verification.error.error_description ??
        "Could not verify the device code.",
    };
  }
  return { ok: true };
}

export async function approveDevice(
  userCode: string,
): Promise<DeviceActionResult> {
  const verified = await verifyDeviceCode(userCode);
  if (!verified.ok) return verified;

  const result = await authClient.device.approve({ userCode });
  if (result.error || !result.data?.success) {
    return {
      ok: false,
      message:
        result.error?.error_description ?? "Could not authorize the device.",
    };
  }
  return { ok: true };
}

export async function denyDevice(
  userCode: string,
): Promise<DeviceActionResult> {
  const verified = await verifyDeviceCode(userCode);
  if (!verified.ok) return verified;

  const result = await authClient.device.deny({ userCode });
  if (result.error || !result.data?.success) {
    return {
      ok: false,
      message: result.error?.error_description ?? "Could not deny the device.",
    };
  }
  return { ok: true };
}
