import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => ({
      organizations: [{ id: "org-a", name: "Org A" }],
      activeOrganizationId: "org-a",
    }),
    useSearch: () => mocks.search,
  }),
}));
vi.mock("#app/data/mcp/oauth.ts", () => ({
  setActiveMcpOrganization: vi.fn(),
  submitMcpConsent: vi.fn(),
}));
vi.mock("#app/lib/auth-client.ts", () => ({ authClient: {} }));

import { Route } from "./consent";

const base = { client_id: "client-123", scope: "observability:read offline_access" };

beforeEach(() => {
  mocks.search = { ...base };
});

function renderPage() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

it("shows a loopback destination as an app on this computer", () => {
  mocks.search = { ...base, redirect_uri: "http://localhost:3118/callback" };
  renderPage();

  expect(screen.getByText("An app on this computer")).toBeVisible();
  expect(screen.getByText("(localhost:3118)")).toBeVisible();
  expect(screen.getByText("client-123")).toBeVisible();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
});

it("shows a remote destination by its address", () => {
  mocks.search = { ...base, redirect_uri: "https://attacker.example/cb" };
  renderPage();

  expect(screen.getByText("attacker.example")).toBeVisible();
  expect(screen.queryByText("An app on this computer")).toBeNull();
});

it.each([undefined, "not a url"])(
  "says the destination is unknown when redirect_uri is %s",
  (redirect_uri) => {
    mocks.search = { ...base, redirect_uri };
    renderPage();

    expect(screen.getByText("An unknown destination")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  },
);
