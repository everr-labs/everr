import { describe, expect, it } from "vite-plus/test";
import {
  AlertingChannelConfigInputSchema,
  AlertingChannelConfigSchema,
} from "#app/data/alerting/schema.ts";

function webhook(headers: { name: string; value?: string }[]) {
  return AlertingChannelConfigInputSchema.safeParse({
    type: "webhook",
    url: "https://203.0.113.10/hook",
    headers,
  });
}

describe("webhook header input", () => {
  it("trims a name and keeps an authorization value", () => {
    expect(webhook([{ name: " Authorization ", value: "Bearer stored-secret" }])).toMatchObject({
      success: true,
      data: {
        type: "webhook",
        headers: [{ name: "Authorization", value: "Bearer stored-secret" }],
      },
    });
  });

  it("rejects a name that rewrites the request, even with surrounding spaces", () => {
    expect(webhook([{ name: " Content-Type ", value: "text/plain" }]).success).toBe(false);
    expect(webhook([{ name: "Host", value: "evil.example" }]).success).toBe(false);
    expect(webhook([{ name: "Proxy-Authorization", value: "Basic abc" }]).success).toBe(false);
  });

  it("rejects a value that could smuggle another header, and the redaction marker", () => {
    expect(webhook([{ name: "X-Token", value: "one\r\ntwo" }]).success).toBe(false);
    expect(webhook([{ name: "X-Token", value: "***" }]).success).toBe(false);
  });

  it("rejects a value Headers cannot send, and keeps a latin-1 value", () => {
    const rejected = webhook([{ name: "X-Token", value: "token-\u0100" }]);
    if (rejected.success) throw new Error("expected the header value to be rejected");
    expect(rejected.error.issues.map((issue) => issue.message)).toContain(
      "header value must contain only latin-1 characters",
    );
    expect(webhook([{ name: "X-Token", value: "token-\u00ff" }]).success).toBe(true);
    expect(
      AlertingChannelConfigSchema.safeParse({
        type: "webhook",
        url: "https://203.0.113.10/hook",
        headers: [{ name: "X-Token", value: "token-\u0100" }],
      }).success,
    ).toBe(false);
  });

  it("allows a header with no value, which is how a write keeps one", () => {
    const parsed = webhook([{ name: "X-Token" }]);
    expect(parsed.success).toBe(true);
  });
});
