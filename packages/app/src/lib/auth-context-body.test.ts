import { describe, expect, it } from "vitest";
import {
  getDeviceApprovalUserCode,
  getDeviceTokenCode,
} from "@/lib/auth-context-body";

describe("auth context body helpers", () => {
  it("reads the device token code only from the device token path", () => {
    expect(
      getDeviceTokenCode({
        path: "/device/token",
        body: { device_code: "device-123" },
      }),
    ).toBe("device-123");
    expect(
      getDeviceTokenCode({
        path: "/device/approve",
        body: { device_code: "device-123" },
      }),
    ).toBeNull();
  });

  it("normalizes the approval user code", () => {
    expect(
      getDeviceApprovalUserCode({
        body: { userCode: "AB-CD-EF" },
      }),
    ).toBe("ABCDEF");
  });

  it("returns null when body fields are missing or not strings", () => {
    expect(getDeviceTokenCode({ path: "/device/token", body: {} })).toBeNull();
    expect(getDeviceApprovalUserCode({ body: { userCode: 123 } })).toBeNull();
  });
});
