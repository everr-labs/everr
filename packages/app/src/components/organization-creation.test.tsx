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
  retry: vi.fn(),
  router: { invalidate: vi.fn(), navigate: vi.fn() },
}));
vi.mock("@/data/organizations", () => ({ createOrganization: mocks.create }));
vi.mock("@/data/organization-provisioning", () => ({
  completeOrganizationSetup: vi.fn().mockResolvedValue(undefined),
  getOrganizationProvisioningStatus: mocks.read,
  retryOrganizationProvisioning: mocks.retry,
}));
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
  mocks.read.mockResolvedValue({
    id: "new",
    status: "ready",
  });
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
it("fetches the new organization's dashboard data instead of reusing the previous organization's fresh cache", async () => {
  const client = show();
  const queryKey = ["panel-query", "usage"];
  const queryFn = vi.fn().mockResolvedValue([{ organization: "new" }]);
  client.setQueryData(queryKey, [{ organization: "previous" }]);
  let finishPreviousRequest!: (rows: { organization: string }[]) => void;
  const previousRequest = client
    .fetchQuery({
      queryKey,
      staleTime: 0,
      queryFn: () =>
        new Promise<{ organization: string }[]>((resolve) => {
          finishPreviousRequest = resolve;
        }),
    })
    .catch(() => undefined);
  mocks.router.navigate.mockImplementation(async () => {
    await client.fetchQuery({ queryKey, queryFn, staleTime: Infinity });
  });
  await confirmName();
  await act(async () => {
    finishPreviousRequest([{ organization: "previous" }]);
    await previousRequest;
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
  expect(client.getQueryData(queryKey)).toEqual([{ organization: "new" }]);
  expect(queryFn).toHaveBeenCalledOnce();
});
it("keeps the same screen until real provisioning completes after the minimum duration", async () => {
  mocks.read.mockResolvedValue({
    id: "new",
    status: "pending",
  });
  const client = show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  mocks.read.mockResolvedValue({
    id: "new",
    status: "ready",
  });
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
it("reassures the user after 30 seconds while polling and still opens the organization when ready", async () => {
  mocks.read.mockResolvedValue({ id: "new", status: "pending" });
  show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(29_999);
  });
  expect(screen.queryByText(/Setup is taking a little longer/)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  const notice = screen.getByText(/Setup is taking a little longer/);
  expect(notice).toHaveTextContent("longer than expected");
  expect(notice).toHaveTextContent(
    "We'll email you as soon as your organization is ready",
  );
  expect(
    screen.getByRole("link", { name: "explore the documentation" }),
  ).toHaveAttribute("href", "https://everr.dev/docs");
  expect(screen.getByRole("link", { name: "contact us" })).toHaveAttribute(
    "href",
    "mailto:hello@everr.dev",
  );
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  const calls = mocks.read.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  expect(mocks.read.mock.calls.length).toBeGreaterThan(calls);
  mocks.read.mockResolvedValue({ id: "new", status: "ready" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_001);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
  expect(screen.queryByText(/Setup is taking a little longer/)).toBeNull();
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
  expect(mocks.create).toHaveBeenCalledWith({
    data: { plan: "pro", organizationName: "Acme", returnTo: "/logs" },
  });
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

it("retries exhausted provisioning without creating another organization", async () => {
  mocks.read.mockResolvedValue({ id: "new", status: "failed" });
  mocks.retry.mockImplementation(async () => {
    mocks.read.mockResolvedValue({ id: "new", status: "ready" });
  });
  show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(
    screen.getByRole("heading", {
      name: "We couldn't finish setting up your organization",
    }),
  ).toBeVisible();
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(mocks.retry).toHaveBeenCalledWith({ data: { organizationId: "new" } });
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.select).toHaveBeenCalledOnce();
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs",
    replace: true,
  });
});

it.each([
  "missing",
  "revoked",
  "switched",
])("returns to organization selection when the organization is %s during setup", async (state) => {
  if (state === "revoked") mocks.read.mockResolvedValue(null);
  else
    mocks.read.mockResolvedValue(
      state === "missing" ? null : { id: "other", status: "ready" },
    );
  show();
  await confirmName();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    to: "/choose-organization",
    search: { returnTo: "/logs" },
    replace: true,
  });
});
