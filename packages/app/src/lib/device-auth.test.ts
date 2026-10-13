import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    device: Object.assign(mocks.verify, {
      approve: mocks.approve,
      deny: mocks.deny,
    }),
    organization: { setActive: mocks.setActive },
  },
}));

import { approveDevice } from "./device-auth";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ data: {} });
  mocks.setActive.mockResolvedValue({ data: {} });
  mocks.approve.mockResolvedValue({ data: { success: true } });
});

it("activates the chosen organization before approving the verified device", async () => {
  mocks.approve.mockImplementation(async () => {
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "org-b" });
    expect(mocks.setActive.mock.settledResults[0].type).toBe("fulfilled");
    return { data: { success: true } };
  });

  expect(await approveDevice("ABCD1234", "org-b")).toEqual({ ok: true });
  expect(mocks.verify).toHaveBeenCalledWith({
    query: { user_code: "ABCD1234" },
  });
  expect(mocks.approve).toHaveBeenCalledWith({ userCode: "ABCD1234" });
});

it("does not approve the device when organization activation is rejected", async () => {
  mocks.setActive.mockResolvedValue({
    error: { message: "Membership revoked" },
  });

  expect(await approveDevice("ABCD1234", "org-b")).toEqual({
    ok: false,
    message: "Membership revoked",
  });
  expect(mocks.approve).not.toHaveBeenCalled();
});

it("does not change organizations when the device code is invalid", async () => {
  mocks.verify.mockResolvedValue({
    error: { error_description: "Invalid or expired code" },
  });

  expect(await approveDevice("INVALID", "org-b")).toEqual({
    ok: false,
    message: "Invalid or expired code",
  });
  expect(mocks.setActive).not.toHaveBeenCalled();
  expect(mocks.approve).not.toHaveBeenCalled();
});
