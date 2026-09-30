import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/query-client";
import { mockCommands } from "../../test-commands";
import { AuthSettingsSection } from "./auth";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe.each(["start", "poll"] as const)("sign-in %s results", (source) => {
  it.each([
    "signed_in",
    "denied",
    "expired",
  ] as const)("handles %s and preserves the account and pending-code caches", async (status) => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const queryClient = createQueryClient();
    const pending = {
      status: "pending",
      user_code: "ABCD-EFGH",
      verification_url: "http://example.test/verify",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      poll_interval_seconds: 5,
    };
    const result =
      status === "signed_in"
        ? { status, session_path: "/tmp/session.json" }
        : { status };
    const profileKey = ["local-app", "user-profile"];
    const orgKey = ["local-app", "org"];
    queryClient.setQueryData(profileKey, { name: "Previous user" });
    queryClient.setQueryData(orgKey, { name: "Previous organization" });
    mockCommands((command) => {
      switch (command) {
        case "get_auth_status":
          return { status: "signed_out", session_path: "/tmp/session.json" };
        case "get_pending_sign_in":
          return source === "poll" ? pending : null;
        case "start_sign_in":
        case "poll_sign_in":
          return result;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthSettingsSection />
      </QueryClientProvider>,
    );
    if (source === "start") {
      fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    }
    const notification = status === "signed_in" ? toast.success : toast.error;
    await waitFor(() => expect(notification).toHaveBeenCalledTimes(1));
    expect(notification).toHaveBeenCalledWith(
      status === "signed_in"
        ? "Signed in."
        : status === "denied"
          ? "The sign-in request was denied."
          : "The sign-in code expired. Refresh it to try again.",
    );
    expect(queryClient.getQueryData(["local-app", "pending-sign-in"])).toEqual(
      source === "poll" && status === "expired" ? pending : null,
    );
    if (status === "signed_in") {
      expect(queryClient.getQueryData(["local-app", "auth-status"])).toEqual(
        result,
      );
      expect(queryClient.getQueryData(profileKey)).toBeUndefined();
      expect(queryClient.getQueryData(orgKey)).toBeUndefined();
    } else {
      expect(queryClient.getQueryData(profileKey)).toEqual({
        name: "Previous user",
      });
      expect(queryClient.getQueryData(orgKey)).toEqual({
        name: "Previous organization",
      });
    }
    queryClient.clear();
  });
});
