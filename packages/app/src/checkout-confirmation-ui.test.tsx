import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@/data/billing", () => ({ confirmOrgCheckout: mocks.confirm }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { Route } from "@/routes/_authenticated/_dashboard/_padded/checkout.success";

const Page = Route.options.component as ComponentType;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("stops confirming and polling when a paid checkout belongs to a different customer", async () => {
  vi.useFakeTimers();
  vi.spyOn(Route, "useSearch").mockReturnValue({
    checkout_id: "d0dc6191-d1e3-4a1e-a8e7-6ba69a6112e7",
  });
  mocks.confirm.mockResolvedValue({ status: "billing_conflict" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(screen.getByText("Billing association needs attention")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Do not repeat the purchase",
  );
  expect(screen.queryByText("Confirming payment")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Back to billing" }),
  ).toHaveAttribute("href", "/billing");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});
