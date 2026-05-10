import { z } from "zod";

const DeviceTokenContextSchema = z
  .object({
    path: z.literal("/device/token"),
    body: z
      .object({
        device_code: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

const DeviceApprovalContextSchema = z
  .object({
    body: z
      .object({
        userCode: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export function getDeviceTokenCode(context: unknown) {
  const parsed = DeviceTokenContextSchema.safeParse(context);
  return parsed.success ? parsed.data.body.device_code : null;
}

export function getDeviceApprovalUserCode(context: unknown) {
  const parsed = DeviceApprovalContextSchema.safeParse(context);
  if (!parsed.success) {
    return null;
  }

  const userCode = parsed.data.body.userCode.replace(/-/g, "");
  return userCode || null;
}
