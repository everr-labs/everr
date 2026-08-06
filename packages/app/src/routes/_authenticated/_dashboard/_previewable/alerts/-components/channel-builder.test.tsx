import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelBuilder } from "./channel-builder";

// Mirror the mock shape used by alert-event-feed.test.tsx.
const testAlertingChannel = vi.fn();
vi.mock("@/data/alerting/server", () => ({
  createAlertingChannel: vi.fn(),
  testAlertingChannel: (...args: unknown[]) => testAlertingChannel(...args),
}));

// Mirror the mock shape used by -account.test.tsx.
const useSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: (...args: unknown[]) => useSession(...args),
  },
}));

// ChannelBuilder reads useQueryClient() for its create-mutation cache
// invalidation, so it needs a provider even though these tests never touch it
// (see silences-panel.test.tsx for the same pattern).
async function renderBuilder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelBuilder open onOpenChange={() => {}} existingNames={[]} />
    </QueryClientProvider>,
  );
  // Base UI moves initial focus into the open dialog asynchronously; typing
  // before that settles can lose keystrokes to the focus trap.
  const drawer = await screen.findByRole("dialog");
  await waitFor(() => {
    expect(drawer.contains(document.activeElement)).toBe(true);
  });
}

describe("ChannelBuilder test button", () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: null });
  });

  it("is disabled until the config is complete", async () => {
    await renderBuilder();
    expect(screen.getByRole("button", { name: /send test/i })).toBeDisabled();
  });

  it("clears a previous result when the config changes", async () => {
    // A stale tick must never describe a config that is no longer on screen.
    testAlertingChannel.mockResolvedValue({ ok: true, latency_ms: 340 });
    const user = userEvent.setup();
    await renderBuilder();

    await user.type(
      screen.getByLabelText(/webhook url/i),
      "https://example.com/hook",
    );
    await user.click(screen.getByRole("button", { name: /send test/i }));
    expect(await screen.findByText(/delivered/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/webhook url/i), "x");
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });

  it("ignores a stale result for a config edited while the request was in flight", async () => {
    // The engine can take a few seconds to answer. If the draft moves on
    // before it does, the response describes a config that's no longer on
    // screen.
    let resolveTest:
      | ((r: { ok: boolean; latency_ms: number }) => void)
      | undefined;
    testAlertingChannel.mockReturnValue(
      new Promise((resolve) => {
        resolveTest = resolve;
      }),
    );
    const user = userEvent.setup();
    await renderBuilder();

    await user.type(
      screen.getByLabelText(/webhook url/i),
      "https://example.com/hook",
    );
    await user.click(screen.getByRole("button", { name: /send test/i }));
    expect(
      screen.getByRole("button", { name: /sending/i }),
    ).toBeInTheDocument();

    // Edit the config before the in-flight request settles.
    await user.type(screen.getByLabelText(/webhook url/i), "/v2");

    resolveTest?.({ ok: true, latency_ms: 340 });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^send test$/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });
});

describe("ChannelBuilder email test note", () => {
  it("names the signed-in address the test actually goes to", async () => {
    useSession.mockReturnValue({ data: { user: { email: "gio@everr.dev" } } });
    const user = userEvent.setup();
    await renderBuilder();

    await user.click(screen.getByRole("combobox", { name: /type/i }));
    await user.click(await screen.findByRole("option", { name: /email/i }));

    expect(screen.getByText(/gio@everr\.dev/)).toBeInTheDocument();
  });

  it("falls back to generic wording when the session hasn't loaded", async () => {
    useSession.mockReturnValue({ data: null });
    const user = userEvent.setup();
    await renderBuilder();

    await user.click(screen.getByRole("combobox", { name: /type/i }));
    await user.click(await screen.findByRole("option", { name: /email/i }));

    expect(screen.getByText(/your own address/i)).toBeInTheDocument();
  });
});
