import { describe, expect, it } from "vitest";
import { AlertingError } from "@/data/alerting/errors";
import { alertingErrorMessage } from "./query-error";

// Server serialization preserves the error fields but not the class.
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
        "channel referenced by a delivery in flight",
      ),
      "channel referenced by a delivery in flight",
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
