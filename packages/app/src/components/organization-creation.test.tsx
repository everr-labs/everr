import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  select: vi.fn(),
  read: vi.fn(),
  router: { invalidate: vi.fn(), navigate: vi.fn() },
}));
vi.mock("@/data/organizations", () => ({ createOrganization: mocks.create }));
vi.mock("@/data/auth", () => ({ getActiveOrganization: mocks.read }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { organization: { setActive: mocks.select } },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mocks.router,
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/account">{children}</a>
  ),
}));

import { OrganizationCreation } from "./organization-creation";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({
    kind: "created",
    organization: { id: "new", name: "Acme" },
  });
  mocks.select.mockResolvedValue({ error: null });
  mocks.read.mockResolvedValue({ id: "new", clickhouseReady: true });
});
afterEach(() => vi.useRealTimers());
function show(canCreateHobby = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OrganizationCreation canCreateHobby={canCreateHobby} returnTo="/logs" />
    </QueryClientProvider>,
  );
  return client;
}
async function confirmName() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Acme" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Organization details" }),
    );
    await vi.advanceTimersByTimeAsync(0);
  });
}
it("replaces the name step immediately while creation is still pending, without a modal", async () => {
  mocks.create.mockReturnValue(new Promise(() => {}));
  show();
  await confirmName();
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("Organization name")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.select).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
});
it("holds a healthy creation for 2.5 seconds, then enters the requested page without reloading", async () => {
  show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2499);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.select).toHaveBeenCalledWith({ organizationId: "new" });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
});
it("keeps the same screen until real provisioning completes after the minimum duration", async () => {
  mocks.read.mockResolvedValue({ id: "new", clickhouseReady: false });
  const client = show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  mocks.read.mockResolvedValue({ id: "new", clickhouseReady: true });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["organization-provisioning", "new"],
    });
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
});
it("retries selection of an already-created organization without creating a duplicate", async () => {
  mocks.select.mockResolvedValueOnce({ error: { message: "unavailable" } });
  show();
  await confirmName();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "organization was created",
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Try selecting again" }),
    );
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.select).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
});
it("opens Pro checkout after the minimum duration without activating an unpaid organization", async () => {
  mocks.create.mockResolvedValue({
    kind: "checkout",
    url: "https://polar.example/checkout",
  });
  show(false);
  await confirmName();
  expect(
    screen.getByRole("heading", { name: "Taking you to checkout" }),
  ).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2499);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "https://polar.example/checkout",
    reloadDocument: true,
  });
  expect(mocks.select).not.toHaveBeenCalled();
});

it("does not select an organization or navigate after leaving an unfinished creation", async () => {
  const result = {
    kind: "created" as const,
    organization: { id: "new", name: "Acme" },
  };
  let finishCreation!: (value: typeof result) => void;
  const pending = new Promise<typeof result>((resolve) => {
    finishCreation = resolve;
  });
  mocks.create.mockReturnValue(pending);
  show();
  await confirmName();
  cleanup();
  await act(async () => {
    finishCreation(result);
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.router.navigate).not.toHaveBeenCalled();
});

it("cancels the checkout handoff when leaving during the minimum duration", async () => {
  mocks.create.mockResolvedValue({
    kind: "checkout",
    url: "https://polar.example/checkout",
  });
  show(false);
  await confirmName();
  cleanup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
});
