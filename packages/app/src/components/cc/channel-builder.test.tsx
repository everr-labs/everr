import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelBuilder } from "./channel-builder";

// Mirror the mock shape used by alert-event-feed.test.tsx.
const testCcChannel = vi.fn();
vi.mock("@/data/cc/server", () => ({
  createCcChannel: vi.fn(),
  testCcChannel: (...args: unknown[]) => testCcChannel(...args),
}));

// ChannelBuilder reads useQueryClient() for its create-mutation cache
// invalidation, so it needs a provider even though these tests never touch it
// (see silences-panel.test.tsx for the same pattern).
function renderBuilder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelBuilder open onOpenChange={() => {}} existingNames={[]} />
    </QueryClientProvider>,
  );
}

describe("ChannelBuilder test button", () => {
  it("is disabled until the config is complete", async () => {
    renderBuilder();
    expect(screen.getByRole("button", { name: /send test/i })).toBeDisabled();
  });

  it("clears a previous result when the config changes", async () => {
    // A stale tick must never describe a config that is no longer on screen.
    testCcChannel.mockResolvedValue({ ok: true, latency_ms: 340 });
    const user = userEvent.setup();
    renderBuilder();

    await user.type(
      screen.getByLabelText(/webhook url/i),
      "https://example.com/hook",
    );
    await user.click(screen.getByRole("button", { name: /send test/i }));
    expect(await screen.findByText(/delivered/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/webhook url/i), "x");
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });
});
