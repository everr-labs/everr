import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { NotificationChannelView } from "#app/data/alerting/delivery/view.ts";
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
    config: { type: "webhook", url: "https://example.com/hook", headers: [] },
  });
});

const PAGER: NotificationChannelView = {
  name: "pager",
  config: {
    type: "webhook",
    url: "***",
    headers: [{ name: "Authorization", value: "***" }],
  },
  tiers: [],
  rules: [],
};

function renderDialog(onSave = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <ChannelDialog
        target={{ mode: "edit", channel: PAGER }}
        channels={[PAGER]}
        pending={false}
        onClose={() => {}}
        onSave={onSave}
        onDelete={() => {}}
      />
    </QueryClientProvider>,
  );
  return onSave;
}

describe("ChannelDialog webhook headers", () => {
  it("keeps a stored header value and sends one the reader adds", async () => {
    const onSave = renderDialog();
    const user = userEvent.setup();

    expect(screen.getByDisplayValue("Authorization")).not.toHaveAttribute("aria-invalid");
    expect(screen.getAllByLabelText("Value")[0]).toHaveValue("Stored securely");
    expect(screen.getAllByLabelText("Value")[0]).not.toHaveAttribute("aria-invalid");

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const names = screen.getAllByPlaceholderText("Authorization");
    await user.clear(names[1]);
    await user.type(names[1], "X-Env");
    const values = screen.getAllByLabelText("Value");
    expect(values[values.length - 1]).toHaveAttribute("aria-invalid", "true");
    await user.type(values[values.length - 1], "staging");
    expect(values[values.length - 1]).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save channel" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "pager",
      config: {
        type: "webhook",
        headers: [{ name: "Authorization" }, { name: "X-Env", value: "staging" }],
      },
    });
  });

  it("clears a header the reader removes", async () => {
    const onSave = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove header Authorization" }));
    await user.click(screen.getByRole("button", { name: "Save channel" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "pager",
      config: { type: "webhook", headers: [] },
    });
  });

  it("refuses a header the send is not allowed to set", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const names = screen.getAllByPlaceholderText("Authorization");
    await user.clear(names[1]);
    await user.type(names[1], "Content-Type");
    const values = screen.getAllByLabelText("Value");
    await user.type(values[values.length - 1], "text/plain");

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be set/i);
    expect(screen.getByDisplayValue("Content-Type")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByDisplayValue("text/plain")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Save channel" })).toBeDisabled();
  });

  it("marks every row that repeats a header name", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const repeated = screen.getAllByDisplayValue("Authorization");
    expect(repeated).toHaveLength(2);
    for (const input of repeated) {
      expect(input).toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.getAllByLabelText("Value")[0]).not.toHaveAttribute("aria-invalid");
  });

  it("asks for header values again when the URL is replaced", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "Edit secret" })[0]);
    await user.type(
      screen.getByRole("textbox", { name: "Webhook URL" }),
      "https://203.0.113.11/hook",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/value is required for Authorization/i);
    expect(screen.getAllByLabelText("Value")[0]).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByDisplayValue("Authorization")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Save channel" })).toBeDisabled();
  });
});
