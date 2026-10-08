import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CreateApiKeyDialog } from "./create-api-key-dialog";

vi.mock("@/data/api-keys", () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { apiKey: {} } }));

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

it("resets default scopes only when the key dialog reopens", async () => {
  const client = new QueryClient();
  clients.push(client);
  const dialog = (scopes: ("ingest" | "apply")[]) => (
    <QueryClientProvider client={client}>
      <CreateApiKeyDialog defaultScopes={scopes} />
    </QueryClientProvider>
  );
  const { rerender } = render(dialog(["ingest"]));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New key" }));
  expect(
    await screen.findByRole("switch", { name: /Send telemetry/ }),
  ).toBeChecked();
  expect(
    screen.getByRole("switch", { name: /Manage as code/ }),
  ).not.toBeChecked();
  rerender(dialog(["apply"]));
  expect(screen.getByRole("switch", { name: /Send telemetry/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "New key" }));
  expect(
    await screen.findByRole("switch", { name: /Manage as code/ }),
  ).toBeChecked();
  expect(
    screen.getByRole("switch", { name: /Send telemetry/ }),
  ).not.toBeChecked();
});
