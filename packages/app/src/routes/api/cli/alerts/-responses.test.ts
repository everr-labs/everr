import { describe, expect, it } from "vitest";
import { AlertingError } from "@/data/alerting/errors";
import { alertingJson, readJsonBody } from "./-responses";

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/cli/alerts/silences", {
    method: "POST",
    body,
  });
}

describe("alertingJson", () => {
  it("answers with what the operation returned", async () => {
    const res = await alertingJson(async () => ({ id: "s-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "s-1" });
  });

  it("answers a refusal with the status and code it carries", async () => {
    const res = await alertingJson(async () => {
      throw new AlertingError(409, "conflict", "still sending");
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "still sending",
      code: "conflict",
    });
  });

  it("leaves anything else to the error reporter as a 500", async () => {
    // A ZodError from reading stored data says the server is broken, not the
    // request, so it must not be flattened into a 422 the caller cannot act on.
    await expect(
      alertingJson(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("readJsonBody", () => {
  it("returns the object a request carries", async () => {
    expect(await readJsonBody(jsonRequest('{"comment":"deploy"}'))).toEqual({
      comment: "deploy",
    });
  });

  it("refuses a body that is not JSON", async () => {
    await expect(readJsonBody(jsonRequest("not json"))).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
  });

  it("refuses a body that is not an object", async () => {
    await expect(readJsonBody(jsonRequest("[1,2]"))).rejects.toMatchObject({
      status: 400,
    });
  });
});
