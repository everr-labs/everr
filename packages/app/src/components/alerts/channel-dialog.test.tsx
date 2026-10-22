import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ChannelDialog, type ChannelTarget } from "./channel-dialog";

vi.mock("#app/data/alerting/delivery/server.ts", () => ({ testAlertingChannel: vi.fn() }));

const client = new QueryClient();
afterEach(() => client.clear());

it.each<{ mode: string; target: ChannelTarget }>([
  { mode: "create", target: { mode: "new", name: "custom-hook" } },
  {
    mode: "edit",
    target: {
      mode: "edit",
      channel: {
        name: "custom-hook",
        config: { type: "slack", url: "***" },
        tiers: [],
        rules: [],
      },
    },
  },
])("can $mode a generic webhook channel", async ({ target }) => {
  const onSave = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ChannelDialog
        target={target}
        channels={[]}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("combobox", { name: "Type" }));
  await user.click(await screen.findByRole("option", { name: "Webhook" }));
  expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Webhook");
  await user.type(screen.getByRole("textbox", { name: "Webhook URL" }), "https://example.com/hook");
  await user.click(screen.getByRole("button", { name: /^(Create|Save) channel$/ }));

  expect(onSave).toHaveBeenCalledWith({
    name: "custom-hook",
    config: { type: "webhook", url: "https://example.com/hook" },
  });
});
