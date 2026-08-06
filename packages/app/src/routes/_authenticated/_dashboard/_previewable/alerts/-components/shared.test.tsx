import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlertingError } from "@/data/alerting/errors";
import type { AlertingSloTier } from "@/data/alerting/types";
import { AlertingSloTierBadge, alertingErrorMessage } from "./shared";

// shared.tsx reaches alertingQueries (server fns) for matcher-value resolution; the
// real module drags server-only env into this client-side test.
vi.mock("@/data/alerting/server", () => ({
  listAlertingRules: vi.fn().mockResolvedValue([]),
  listAlertingSlos: vi.fn().mockResolvedValue([]),
}));

// A AlertingError that crossed the server-fn boundary: structurally intact, but
// no longer an instance of the class.
const wireError = Object.assign(new Error("silence not found"), {
  name: "AlertingError",
  status: 404,
  code: "not_found",
});

describe("alertingErrorMessage", () => {
  it.each<[string, unknown, string]>([
    [
      "an alert transport failure (status 0) to the unavailable message",
      new AlertingError(
        0,
        "unreachable",
        "alert engine unreachable: ECONNREFUSED",
      ),
      "Alerting service unavailable",
    ],
    [
      "an alert timeout (status 0) to the unavailable message",
      new AlertingError(0, "timeout", "alert engine request timed out"),
      "Alerting service unavailable",
    ],
    [
      "an API-level failure to the problem+json detail, verbatim",
      new AlertingError(
        409,
        "conflict",
        "channel referenced by receiver oncall",
      ),
      "channel referenced by receiver oncall",
    ],
    [
      "the serialized server-fn shape, not just live instances",
      wireError,
      "silence not found",
    ],
    [
      "a non-alert transport error to the unavailable message, by sniffing",
      new TypeError("Failed to fetch"),
      "Alerting service unavailable",
    ],
    [
      "any other Error to its own message",
      new Error("something else broke"),
      "something else broke",
    ],
    ["a non-Error throw to the unknown fallback", "nope", "Unknown error"],
  ])("maps %s", (_case, error, expected) => {
    expect(alertingErrorMessage(error)).toBe(expected);
  });
});

describe("AlertingSloTierBadge", () => {
  const tiers: AlertingSloTier[] = [
    {
      name: "ticket",
      long_window: "2h 24m",
      short_window: "12m",
      burn_rate: 1,
      severity: "warning",
    },
  ];

  it("names the tier and stays keyboard reachable", () => {
    render(<AlertingSloTierBadge tier="ticket" severity="warning" />);
    // A button, not a span: the definition below is the only explanation of
    // the word there is, so it must be reachable without a mouse.
    expect(screen.getByRole("button", { name: "ticket" })).toBeInTheDocument();
  });

  it("defines the tier from the SLO's own scaled windows", async () => {
    const user = userEvent.setup();
    render(
      <AlertingSloTierBadge tier="ticket" severity="warning" tiers={tiers} />,
    );

    await user.hover(screen.getByRole("button", { name: "ticket" }));

    // The SLO's resolved windows, not the canonical 30-day ones: a 1d SLO's
    // ticket tier watches 2h 24m, and quoting "3d" at it would be a lie.
    expect(
      await screen.findByText(/last 2h 24m and the last 12m/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Opens a ticket/)).toBeInTheDocument();
  });

  it("says so rather than inventing thresholds for an unknown tier", async () => {
    const user = userEvent.setup();
    render(<AlertingSloTierBadge tier="since-removed" severity="critical" />);

    await user.hover(screen.getByRole("button", { name: "since-removed" }));

    expect(await screen.findByText(/no longer defines/)).toBeInTheDocument();
    // The consequence still holds: severity is stamped on the event itself.
    expect(screen.getByText(/Pages/)).toBeInTheDocument();
  });
});
