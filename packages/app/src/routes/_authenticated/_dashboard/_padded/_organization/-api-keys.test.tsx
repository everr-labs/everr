import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ApiKey } from "@/data/api-keys";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => ({}),
}));
vi.mock("@/data/api-keys", () => mocks);
// The page's admin guard runs in `beforeLoad`, never in the component, so the
// handler only has to exist.
vi.mock("@/lib/serverFn", () => ({
  createAuthenticatedServerFn: { handler: (fn: unknown) => fn },
}));

import { Route } from "./api-keys";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("/api-keys route", () => {
  it("shows and copies public values while keeping secret keys masked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.listApiKeys.mockResolvedValue([
      {
        id: "public",
        configId: "public",
        publicKey: "pk_public_full_value",
        name: "browser",
        start: "sk_pub",
        metadata: JSON.stringify({
          allowedOrigins: ["https://app.example.com"],
        }),
      },
      {
        id: "secret",
        configId: "secret",
        name: "server",
        start: "sk_sec",
        key: "secret_hash_must_not_be_displayed",
        metadata: null,
      },
    ]);

    const Page = Route.options.component as React.ComponentType;
    render(<Page />, { wrapper });

    expect(await screen.findByText("pk_public_full_value")).toBeInTheDocument();
    expect(screen.getByText("sk_sec…")).toBeInTheDocument();
    expect(screen.queryByText("secret_hash_must_not_be_displayed")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Copy public key" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Copy public key" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("pk_public_full_value"),
    );
  });

  it("keeps the issued key on screen after the first key lands in the list", async () => {
    const keys: ApiKey[] = [];
    mocks.listApiKeys.mockImplementation(async () => [...keys]);
    mocks.createApiKey.mockImplementation(async () => {
      keys.push({ id: "k1", configId: "secret", name: "ci-deploy" } as ApiKey);
      return { key: "sk_the_only_copy" };
    });

    const Page = Route.options.component as React.ComponentType;
    render(<Page />, { wrapper });

    // Each interaction re-queries: the node a `findBy*` resolves with can be
    // replaced by the next render, and an event on a stale node reaches nothing.
    await screen.findByRole("button", { name: "New key" });
    fireEvent.click(screen.getByRole("button", { name: "New key" }));
    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "ci-deploy" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /Send telemetry/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText("sk_the_only_copy")).toBeInTheDocument();
    // The refetch flips the list out of its empty state. The issued key has to
    // survive that render: it is the only time it is ever shown.
    expect(await screen.findByText("ci-deploy")).toBeInTheDocument();
    expect(screen.getByText("sk_the_only_copy")).toBeInTheDocument();
  });
});
