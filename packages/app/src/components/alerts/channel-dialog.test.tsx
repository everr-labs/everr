import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { NotificationChannelView } from "#app/data/alerting/delivery/view.ts";
import { testAlertingChannel } from "#app/data/alerting/delivery/server.ts";
import { ChannelDialog, type ChannelTarget } from "./channel-dialog";

vi.mock("#app/data/alerting/delivery/server.ts", () => ({ testAlertingChannel: vi.fn() }));

const client = new QueryClient();
afterEach(() => {
  client.clear();
  vi.mocked(testAlertingChannel).mockReset();
});

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
  // Strict mode re-runs effects, which is what made the form reset a stored
  // draft in a loop when its default values were rebuilt on each render.
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ChannelDialog
          target={{ mode: "edit", channel: PAGER }}
          channels={[PAGER]}
          pending={false}
          onClose={() => {}}
          onSave={onSave}
          onDelete={() => {}}
        />
      </QueryClientProvider>
    </StrictMode>,
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
    await user.type(names[1], "X-Env");
    const values = screen.getAllByLabelText("Value");
    await user.type(values[values.length - 1], "staging");
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

  it("starts a new header row empty, with no error before a save", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const names = screen.getAllByPlaceholderText("Authorization");
    expect(names[1]).toHaveValue("");
    await user.type(names[1], "X-Env");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    for (const input of [...names, ...screen.getAllByLabelText("Value")]) {
      expect(input).not.toHaveAttribute("aria-invalid");
    }
  });

  it("shows a missing header value once Save is clicked, then follows the edits", async () => {
    const onSave = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getAllByPlaceholderText("Authorization")[1], "X-Env");
    await user.click(screen.getByRole("button", { name: "Save channel" }));

    expect(onSave).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Header value is required for X-Env");
    const values = screen.getAllByLabelText("Value");
    expect(values[1]).toHaveAttribute("aria-invalid", "true");
    expect(values[1].closest("li")).toContainElement(alert);

    await user.type(values[1], "staging");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(values[1]).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save channel" }));
    expect(onSave).toHaveBeenCalledWith({
      name: "pager",
      config: {
        type: "webhook",
        headers: [{ name: "Authorization" }, { name: "X-Env", value: "staging" }],
      },
    });
  });

  it("shows why an invalid draft cannot be tested, without sending it", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getAllByPlaceholderText("Authorization")[1], "X-Env");
    await user.click(screen.getByRole("button", { name: "Send test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/value is required for X-Env/i);
    expect(testAlertingChannel).not.toHaveBeenCalled();
  });

  it("refuses a header the send is not allowed to set", async () => {
    const onSave = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const names = screen.getAllByPlaceholderText("Authorization");
    await user.type(names[1], "Content-Type");
    const values = screen.getAllByLabelText("Value");
    await user.type(values[values.length - 1], "text/plain");
    await user.click(screen.getByRole("button", { name: "Save channel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be set/i);
    expect(screen.getByDisplayValue("Content-Type")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByDisplayValue("text/plain")).not.toHaveAttribute("aria-invalid");
  });

  it("marks every row that repeats a header name", async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getAllByPlaceholderText("Authorization")[1], "Authorization");
    await user.click(screen.getByRole("button", { name: "Save channel" }));
    const repeated = screen.getAllByDisplayValue("Authorization");
    expect(repeated).toHaveLength(2);
    for (const input of repeated) {
      expect(input).toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.getAllByLabelText("Value")[0]).not.toHaveAttribute("aria-invalid");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Header Authorization is already set",
      "Header Authorization is already set",
      "Header value is required for Authorization",
    ]);
  });

  it("asks for header values again when the URL is replaced", async () => {
    const onSave = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "Edit secret" })[0]);
    await user.type(
      screen.getByRole("textbox", { name: "Webhook URL" }),
      "https://203.0.113.11/hook",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save channel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /value is required for Authorization/i,
    );
    expect(screen.getAllByLabelText("Value")[0]).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByDisplayValue("Authorization")).not.toHaveAttribute("aria-invalid");
  });
});

describe("ChannelDialog validation", () => {
  it("names a taken channel name only once Create is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <ChannelDialog
          target={{ mode: "new", name: "pager" }}
          channels={[PAGER]}
          pending={false}
          onClose={() => {}}
          onSave={onSave}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );

    // The dialog moves focus to its first field a frame after it opens. Typing
    // before then sends the rest of the URL into Name.
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    await user.type(
      screen.getByRole("textbox", { name: "Incoming webhook URL" }),
      "https://hooks.slack.com/services/T000/B000/x",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create channel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A channel with this name already exists",
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("names each missing field once Create is clicked, with the buttons enabled", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <ChannelDialog
          target={{ mode: "new", name: "" }}
          channels={[]}
          pending={false}
          onClose={() => {}}
          onSave={onSave}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );

    const create = screen.getByRole("button", { name: "Create channel" });
    expect(create).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
    await user.click(create);

    expect(onSave).not.toHaveBeenCalled();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "Name is required",
      "URL is required",
    ]);
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Incoming webhook URL" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await user.type(screen.getByLabelText("Name"), "oncall");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "URL is required",
    ]);
  });

  it("asks for a bot token and a chat on a new Telegram channel", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <ChannelDialog
          target={{ mode: "new", name: "tg" }}
          channels={[]}
          pending={false}
          onClose={() => {}}
          onSave={vi.fn()}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Telegram" }));
    await user.click(screen.getByRole("button", { name: "Send test" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "Bot token is required",
      "Add at least one chat ID",
    ]);
    expect(testAlertingChannel).not.toHaveBeenCalled();
  });

  it("sends a test of a valid draft, keeping the stored secrets", async () => {
    vi.mocked(testAlertingChannel).mockResolvedValue({ ok: true, latency_ms: 12 });
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Send test" }));

    expect(testAlertingChannel).toHaveBeenCalledWith({
      data: {
        config: { type: "webhook", headers: [{ name: "Authorization" }] },
        source: { kind: "saved", name: "pager" },
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Delivered in 12ms");
  });
});
