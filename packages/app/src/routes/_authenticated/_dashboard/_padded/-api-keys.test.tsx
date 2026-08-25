import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  it("keeps the issued key on screen after the first key lands in the list", async () => {
    const keys: ApiKey[] = [];
    mocks.listApiKeys.mockImplementation(async () => [...keys]);
    mocks.createApiKey.mockImplementation(async () => {
      keys.push({ id: "k1", name: "ci-deploy" } as ApiKey);
      return { key: "ek_the_only_copy" };
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

    expect(await screen.findByText("ek_the_only_copy")).toBeInTheDocument();
    // The refetch flips the list out of its empty state. The issued key has to
    // survive that render: it is the only time it is ever shown.
    expect(await screen.findByText("ci-deploy")).toBeInTheDocument();
    expect(screen.getByText("ek_the_only_copy")).toBeInTheDocument();
  });
});
