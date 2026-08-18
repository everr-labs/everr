import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AlertingChannel } from "@/data/alerting/types";
import { DeliverySection } from "./delivery-section";

const getAlertingDefaultDestination = vi.fn();
const setAlertingDefaultDestination = vi.fn();
vi.mock("@/data/alerting/delivery/server", () => ({
  getAlertingDefaultDestination: () => getAlertingDefaultDestination(),
  listAlertingChannels: vi.fn().mockResolvedValue([]),
  setAlertingDefaultDestination: (...args: unknown[]) =>
    setAlertingDefaultDestination(...args),
}));

const pager = {
  name: "pager",
  config: { type: "webhook" },
} as unknown as AlertingChannel;

function renderSection({ editing = false } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DeliverySection
        channels={[pager]}
        editing={editing}
        onEditingChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("DeliverySection", () => {
  it("does not offer editing until the saved destination has been read", async () => {
    // An editor opened over an unread destination drafts an empty selection,
    // and saving that deletes the live one.
    getAlertingDefaultDestination.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(
      screen.getByRole("button", { name: /edit delivery/i }),
    ).toBeDisabled();
  });

  it("asks before a save that leaves every alert undelivered", async () => {
    getAlertingDefaultDestination.mockResolvedValue({
      tiers: { all: ["pager"] },
    });
    const user = userEvent.setup();
    renderSection({ editing: true });

    await user.click(await screen.findByLabelText(/all alerts channel pager/i));
    await user.click(screen.getByRole("button", { name: /save delivery/i }));

    expect(
      await screen.findByText(/stop delivering to every channel/i),
    ).toBeInTheDocument();
    expect(setAlertingDefaultDestination).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /save with no channels/i }),
    );
    expect(setAlertingDefaultDestination).toHaveBeenCalledWith({
      data: { tiers: {} },
    });
  });

  it("saves a non-empty selection without a confirmation", async () => {
    getAlertingDefaultDestination.mockResolvedValue({ tiers: {} });
    const user = userEvent.setup();
    renderSection({ editing: true });

    await user.click(await screen.findByLabelText(/all alerts channel pager/i));
    await user.click(screen.getByRole("button", { name: /save delivery/i }));

    expect(setAlertingDefaultDestination).toHaveBeenCalledWith({
      data: { tiers: { all: ["pager"] } },
    });
  });
});
