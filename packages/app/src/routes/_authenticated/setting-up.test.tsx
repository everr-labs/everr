import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  navigate: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: vi.fn((args: unknown) => args),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/data/sql-api-provision", () => ({
  getSqlApiOrgUserSetup: mocks.get,
  retrySqlApiOrgUserSetup: mocks.retry,
}));

import { Route } from "./setting-up";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as () => ReactNode;
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setting up page", () => {
  it("tells the person the account is still being finished", async () => {
    mocks.get.mockResolvedValue({ status: "pending" });

    renderPage();

    expect(
      await screen.findByText("We're finishing setting up your account."),
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opens the app once setup is ready", async () => {
    mocks.get.mockResolvedValue({ status: "ready" });

    renderPage();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    });
  });

  it("offers another try after the retries are exhausted", async () => {
    mocks.get.mockResolvedValue({ status: "failed" });
    mocks.retry.mockResolvedValue({ status: "pending" });

    renderPage();

    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
