import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ApiKeysSections } from "./api-keys-table";
import type { ApiKey } from "./queries";

vi.mock("#app/data/api-keys.ts", () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));
vi.mock("#app/lib/auth-client.ts", () => ({ authClient: { apiKey: {} } }));

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

const origins = ["https://everr.dev", "https://www.everr.dev", "https://docs.everr.dev"];
const publicKey: ApiKey = {
  id: "ak_public",
  configId: "public",
  name: "marketing-site",
  start: "ek_mrZ",
  prefix: "ek_",
  createdAt: new Date("2026-11-17T10:00:00Z"),
  expiresAt: null,
  lastRequest: null,
  permissions: { ingest: ["write"] },
  metadata: { public: true, allowedOrigins: origins },
  fullKey: "ek_mrZfullpublickeyvalue0123456789",
};

function renderSections(keys: ApiKey[]) {
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ApiKeysSections keys={keys} />
    </QueryClientProvider>,
  );
}

it("shows the full public key from its prefix", async () => {
  renderSections([publicKey]);
  expect(screen.queryByText(publicKey.fullKey ?? "")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Show the full key for marketing-site" }));
  expect(await screen.findByText(publicKey.fullKey ?? "")).toBeVisible();
});

it("lists every allowed origin from the +N", async () => {
  renderSections([publicKey]);
  expect(screen.queryByText("https://docs.everr.dev")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Show all 3 allowed origins" }));
  expect(await screen.findByText("https://docs.everr.dev")).toBeVisible();
});

it("offers no reveal or copy for a public key created before keys could be shown", () => {
  renderSections([{ ...publicKey, configId: "ingest", fullKey: undefined }]);
  expect(screen.queryByRole("button", { name: /Show the full key/ })).toBeNull();
  expect(screen.getByText("Not copyable")).toBeInTheDocument();
});
