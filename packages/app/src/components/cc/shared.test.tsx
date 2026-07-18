import { describe, expect, it } from "vitest";
import { CcApiError } from "@/data/cc/errors";
import { ccErrorMessage } from "./shared";

describe("ccErrorMessage", () => {
  it("maps CC transport failures (status 0) to the unavailable message", () => {
    expect(
      ccErrorMessage(
        new CcApiError(
          0,
          "unreachable",
          "clickety-clack unreachable: ECONNREFUSED",
        ),
      ),
    ).toBe("Alerting service unavailable");
    expect(
      ccErrorMessage(
        new CcApiError(0, "timeout", "clickety-clack request timed out"),
      ),
    ).toBe("Alerting service unavailable");
  });

  it("surfaces CC problem+json detail verbatim for API-level errors", () => {
    expect(
      ccErrorMessage(
        new CcApiError(
          409,
          "conflict",
          "channel referenced by receiver oncall",
        ),
      ),
    ).toBe("channel referenced by receiver oncall");
  });

  it("decodes the serialized server-fn shape, not just live instances", () => {
    const wire = Object.assign(new Error("silence not found"), {
      name: "CcApiError",
      status: 404,
      code: "not_found",
    });
    expect(ccErrorMessage(wire)).toBe("silence not found");
  });

  it("falls back to message sniffing only for non-CC transport errors", () => {
    expect(ccErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Alerting service unavailable",
    );
    expect(ccErrorMessage(new Error("something else broke"))).toBe(
      "something else broke",
    );
    expect(ccErrorMessage("nope")).toBe("Unknown error");
  });
});
