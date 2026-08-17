import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelBuilder } from "./channel-builder";

// Keep the alerting query mock at the module boundary used by the component.
const testAlertingChannel = vi.fn();
vi.mock("@/data/alerting/delivery/server", () => ({
  createAlertingChannel: vi.fn(),
  testAlertingChannel: (...args: unknown[]) => testAlertingChannel(...args),
  testAlertingSavedChannel: vi.fn(),
}));

vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: vi.fn().mockResolvedValue([]),
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
  // A new channel starts with no type, so the fields below only exist once
  // one is picked. Webhook is the plain-URL case these tests drive.
  await userEvent.click(screen.getByRole("radio", { name: /webhook/i }));
}

describe("ChannelBuilder test button", () => {
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
    // Ignore a response when the draft changed while the request was open.
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
