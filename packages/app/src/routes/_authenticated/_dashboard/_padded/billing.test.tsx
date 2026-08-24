import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureOrgBillingAdmin: vi.fn(),
  getOrgEntitlement: vi.fn(),
  getOrgUsage: vi.fn(),
  getOrgUsageSeries: vi.fn(),
  getOrgPortalUrl: vi.fn(),
  startOrgCheckout: vi.fn(),
  useActiveOrganization: vi.fn(),
  useQuery: vi.fn(),
  resolveUsagePeriod: vi.fn(),
  usageSection: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
    options,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
}));

vi.mock("@/components/billing/usage-section", () => ({
  UsageSection: (props: Record<string, unknown>) => {
    mocks.usageSection(props);
    return <div data-testid="usage-section">usage section</div>;
  },
}));

vi.mock("@/data/billing", () => {
  class NotBillingAdminError extends Error {
    name = "NotBillingAdminError";
  }

  return {
    ensureOrgBillingAdmin: mocks.ensureOrgBillingAdmin,
    getOrgEntitlement: mocks.getOrgEntitlement,
    getOrgPortalUrl: mocks.getOrgPortalUrl,
    NotBillingAdminError,
    startOrgCheckout: mocks.startOrgCheckout,
  };
});

vi.mock("@/data/usage", () => ({
  getOrgUsage: mocks.getOrgUsage,
  getOrgUsageSeries: mocks.getOrgUsageSeries,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: mocks.useActiveOrganization,
  },
}));

vi.mock("@/lib/usage-period", () => ({
  resolveUsagePeriod: mocks.resolveUsagePeriod,
}));

import { Route } from "./billing";

const entitlement = {
  tier: "pro" as const,
  status: "active",
  currentPeriodStart: new Date("2026-08-10T12:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-10T12:00:00.000Z"),
  cancelAtPeriodEnd: false,
  serverNow: "2026-08-24T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useActiveOrganization.mockReturnValue({
    data: { id: "org_42", name: "Test Org" },
  });
  mocks.getOrgUsage.mockResolvedValue([]);
  mocks.getOrgUsageSeries.mockResolvedValue([]);
  mocks.resolveUsagePeriod.mockReturnValue({
    from: new Date("2026-08-10T12:00:00.000Z"),
    to: new Date("2026-09-10T12:00:00.000Z"),
    source: "subscription",
  });
  mocks.useQuery.mockImplementation(
    (options: { queryKey: unknown[]; queryFn: () => unknown }) => {
      const kind = options.queryKey[2];
      if (kind === "totals" || kind === "series") {
        return {
          data: [],
          isPending: false,
          isError: false,
          status: "success",
        };
      }
      return {
        data: entitlement,
        isPending: false,
        isError: false,
        status: "success",
      };
    },
  );
});

describe("billing usage route", () => {
  it("keys both usage queries by organization and exact period bounds", async () => {
    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(screen.getByTestId("usage-section")).toBeVisible();
    const queryOptions = mocks.useQuery.mock.calls.map(([options]) => options);
    expect(queryOptions.map((options) => options.queryKey)).toEqual([
      ["billing", "entitlement", "org_42"],
      [
        "billing",
        "usage",
        "totals",
        "org_42",
        "2026-08-10T12:00:00.000Z",
        "2026-09-10T12:00:00.000Z",
      ],
      [
        "billing",
        "usage",
        "series",
        "org_42",
        "2026-08-10T12:00:00.000Z",
        "2026-09-10T12:00:00.000Z",
      ],
    ]);

    await queryOptions[1].queryFn();
    await queryOptions[2].queryFn();
    const range = {
      from: "2026-08-10T12:00:00.000Z",
      to: "2026-09-10T12:00:00.000Z",
    };
    expect(mocks.getOrgUsage).toHaveBeenCalledWith({ data: range });
    expect(mocks.getOrgUsageSeries).toHaveBeenCalledWith({ data: range });
    expect(mocks.usageSection).toHaveBeenCalledWith(
      expect.objectContaining({
        totalsStatus: "success",
        seriesStatus: "success",
      }),
    );
  });

  it("resolves calendar fallback periods from the server timestamp", () => {
    const freeEntitlement = {
      tier: "free" as const,
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      serverNow: "2026-09-01T00:00:00.123Z",
    };
    mocks.useQuery.mockImplementation((options: { queryKey: unknown[] }) =>
      options.queryKey[1] === "entitlement"
        ? {
            data: freeEntitlement,
            isPending: false,
            isError: false,
            status: "success",
          }
        : {
            data: [],
            isPending: false,
            isError: false,
            status: "success",
          },
    );

    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(mocks.resolveUsagePeriod).toHaveBeenCalledWith(
      freeEntitlement,
      new Date("2026-09-01T00:00:00.123Z"),
    );
  });

  it("does not render stale entitlement content alongside an error", () => {
    mocks.useQuery.mockImplementation((options: { queryKey: unknown[] }) =>
      options.queryKey[1] === "entitlement"
        ? {
            data: entitlement,
            isPending: false,
            isError: true,
            status: "error",
          }
        : {
            data: [],
            isPending: false,
            isError: false,
            status: "success",
          },
    );

    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Billing details are unavailable",
    );
    expect(mocks.resolveUsagePeriod).not.toHaveBeenCalled();
    expect(screen.queryByTestId("usage-section")).not.toBeInTheDocument();
    expect(screen.queryByText("Current plan")).not.toBeInTheDocument();
  });

  it("keeps the authorization check on route entry", async () => {
    mocks.ensureOrgBillingAdmin.mockResolvedValue({ ok: true });

    await (Route.options.beforeLoad as () => Promise<unknown>)();

    expect(mocks.ensureOrgBillingAdmin).toHaveBeenCalledOnce();
  });
});
