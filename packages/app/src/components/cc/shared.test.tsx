import { describe, expect, it } from "vitest";
import { CcApiError } from "@/data/cc/errors";
import { ccErrorMessage } from "./shared";

// A CcApiError that crossed the server-fn boundary: structurally intact, but
// no longer an instance of the class.
const wireError = Object.assign(new Error("silence not found"), {
  name: "CcApiError",
  status: 404,
  code: "not_found",
});

describe("ccErrorMessage", () => {
  it.each<[string, unknown, string]>([
    [
      "a CC transport failure (status 0) to the unavailable message",
      new CcApiError(
        0,
        "unreachable",
        "clickety-clack unreachable: ECONNREFUSED",
      ),
      "Alerting service unavailable",
    ],
    [
      "a CC timeout (status 0) to the unavailable message",
      new CcApiError(0, "timeout", "clickety-clack request timed out"),
      "Alerting service unavailable",
    ],
    [
      "an API-level failure to CC's problem+json detail, verbatim",
      new CcApiError(409, "conflict", "channel referenced by receiver oncall"),
      "channel referenced by receiver oncall",
    ],
    [
      "the serialized server-fn shape, not just live instances",
      wireError,
      "silence not found",
    ],
    [
      "a non-CC transport error to the unavailable message, by sniffing",
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
    expect(ccErrorMessage(error)).toBe(expected);
  });
});
