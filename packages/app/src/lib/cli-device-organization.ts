import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import {
  getDeviceApprovalUserCode,
  getDeviceTokenCode,
} from "@/lib/auth-context-body";
import {
  getActiveOrganizationIdFromAuthSession,
  getDeviceOrgIdFromScope,
  withDeviceOrgScope,
} from "@/lib/device-org-scope";

// Carries the approval-time org from the /device/token before-hook to the
// session.create database hook. better-auth consumes (deletes) the device-code
// row before creating the session, so the org can't be read back from the row
// at session-create time; and better-auth offers no documented way to pass
// app data from an endpoint hook into a database hook. An app-owned
// AsyncLocalStorage sidesteps both: the auth route handler opens a capture
// scope around auth.handler(request), and both hooks run inside it.
const deviceOrgCapture = new AsyncLocalStorage<{
  organizationId: string | null;
}>();

export function runWithDeviceOrgCapture<T>(fn: () => T): T {
  return deviceOrgCapture.run({ organizationId: null }, fn);
}

// Returns false when called outside runWithDeviceOrgCapture, so the caller
// can make the misconfiguration loud instead of silently losing the org.
function captureDeviceOrganizationId(organizationId: string) {
  const store = deviceOrgCapture.getStore();
  if (!store) {
    return false;
  }

  store.organizationId = organizationId;
  return true;
}

export function getCapturedDeviceOrganizationId() {
  return deviceOrgCapture.getStore()?.organizationId ?? null;
}

type DeviceCodeRecord = {
  id: string;
  scope: string | null;
};

// Lands CLI device logins on the org the browser had active at approval:
// /device/approve stamps that org into the device-code row's scope, and
// /device/token reads it back — before better-auth consumes the row — into
// the capture scope for the session.create hook.
export function cliDeviceOrganizationPlugin(options?: {
  onError?: (stage: "mark" | "capture", error: unknown) => void;
}) {
  return {
    id: "cli-device-organization",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/device/approve",
          handler: createAuthMiddleware(async (context) => {
            const userCode = getDeviceApprovalUserCode(context);
            if (!userCode) {
              return;
            }

            const browserSession = await getSessionFromCtx(context);
            const activeOrganizationId =
              getActiveOrganizationIdFromAuthSession(browserSession);
            if (!activeOrganizationId) {
              return;
            }

            try {
              const record =
                await context.context.adapter.findOne<DeviceCodeRecord>({
                  model: "deviceCode",
                  where: [{ field: "userCode", value: userCode }],
                });
              if (!record) {
                return;
              }

              await context.context.adapter.update({
                model: "deviceCode",
                where: [{ field: "id", value: record.id }],
                update: {
                  scope: withDeviceOrgScope(record.scope, activeOrganizationId),
                },
              });
            } catch (error) {
              // Marking the device code with the active org is purely an
              // enhancement; never let a DB failure break /device/approve.
              options?.onError?.("mark", error);
            }
          }),
        },
        {
          matcher: (context) => context.path === "/device/token",
          handler: createAuthMiddleware(async (context) => {
            const deviceCodeValue = getDeviceTokenCode(context);
            if (!deviceCodeValue) {
              return;
            }

            try {
              const record = await context.context.adapter.findOne<
                Pick<DeviceCodeRecord, "scope">
              >({
                model: "deviceCode",
                where: [{ field: "deviceCode", value: deviceCodeValue }],
              });

              const organizationId = getDeviceOrgIdFromScope(record?.scope);
              if (
                organizationId &&
                !captureDeviceOrganizationId(organizationId)
              ) {
                options?.onError?.(
                  "capture",
                  new Error(
                    "device org captured outside runWithDeviceOrgCapture; wrap the auth handler",
                  ),
                );
              }
            } catch (error) {
              // Carrying the org across is an enhancement; never let a DB
              // failure break the token exchange.
              options?.onError?.("capture", error);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
