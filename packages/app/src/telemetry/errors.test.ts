import { describe, expect, it } from "vitest";
import { getExceptionAttributes } from "./errors";
import { getExceptionAttributes as getSharedExceptionAttributes } from "./shared.ts";

describe("getExceptionAttributes", () => {
  it("captures useful fields from Error values", () => {
    const error = new TypeError("bad token=secret@example.com");
    error.stack = "TypeError: bad token=secret@example.com";

    expect(getExceptionAttributes(error)).toEqual({
      "exception.message": "bad token=[REDACTED]",
      "exception.stacktrace": "TypeError: bad token=[REDACTED]",
      "exception.type": "TypeError",
    });
  });

  it("handles non-Error thrown values", () => {
    expect(getExceptionAttributes("plain failure")).toEqual({
      "exception.message": "plain failure",
      "exception.type": "NonErrorException",
    });
  });

  it("shares redaction with Node instrumentation", () => {
    const error = new Error("bad Bearer abc123 token=secret a@example.com");

    expect(getSharedExceptionAttributes(error)).toEqual(
      getExceptionAttributes(error),
    );
  });
});
