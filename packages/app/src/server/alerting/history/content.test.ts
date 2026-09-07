import { describe, expect, it } from "vitest";
import {
  ALERT_LABEL_KEY_MAX,
  ALERT_LABEL_VALUE_MAX,
  buildAlertContextJson,
  capAlertLabels,
  resolveAlertServiceName,
  sanitizeAlertError,
} from "./content";

describe("capAlertLabels", () => {
  it("truncates oversized keys instead of dropping them", () => {
    const longKey = "k".repeat(ALERT_LABEL_KEY_MAX + 50);
    const capped = capAlertLabels({ [longKey]: "value" });
    expect(capped).toEqual({ ["k".repeat(ALERT_LABEL_KEY_MAX)]: "value" });
  });

  it("truncates oversized values instead of dropping them", () => {
    const longValue = "v".repeat(ALERT_LABEL_VALUE_MAX + 50);
    const capped = capAlertLabels({ service: longValue });
    expect(capped).toEqual({ service: "v".repeat(ALERT_LABEL_VALUE_MAX) });
  });

  it("passes labels within the caps through unchanged", () => {
    const labels = { service: "checkout", region: "eu-west-1" };
    expect(capAlertLabels(labels)).toEqual(labels);
  });
});

describe("resolveAlertServiceName", () => {
  it("prefers a service label, case-insensitively, in any spelling", () => {
    expect(resolveAlertServiceName({ service: "checkout" })).toBe("checkout");
    expect(resolveAlertServiceName({ Service_Name: "api" })).toBe("api");
    expect(resolveAlertServiceName({ "service-name": "web" })).toBe("web");
    expect(resolveAlertServiceName({ servicename: "jobs" })).toBe("jobs");
  });

  it("prefers the exact service key when several match", () => {
    expect(
      resolveAlertServiceName({ service_name: "beta", service: "alpha" }),
    ).toBe("alpha");
  });

  it("falls back to the alert marker", () => {
    expect(resolveAlertServiceName({ region: "eu" })).toBe("alert");
    expect(resolveAlertServiceName({})).toBe("alert");
    expect(resolveAlertServiceName({ service: "" })).toBe("alert");
  });
});

// A placeholder, never a silent cut: `last_error` is what an operator reads
// when a notification did not arrive, and "the URL was removed here" and "no
// URL was ever in this message" are different answers to why it failed.
describe("sanitizeAlertError", () => {
  it("strips webhook URLs", () => {
    const sanitized = sanitizeAlertError(
      "request to https://hooks.slack.com/services/T000/B000/secret failed, retrying",
    );
    expect(sanitized).not.toContain("hooks.slack.com");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("[redacted-url]");
    expect(sanitized).toContain("failed, retrying");
  });

  it("strips scheme-less webhook hosts", () => {
    const sanitized = sanitizeAlertError(
      "POST hooks.slack.com/services/T000/B000/secret returned 404",
    );
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("[redacted-url]");
    expect(sanitized).toContain("returned 404");
  });

  it("strips bot tokens", () => {
    const sanitized = sanitizeAlertError(
      "telegram: 401 for bot 1234567890:AAHrx3xkeNiG5FakeTokenValue-abc123 unauthorized",
    );
    expect(sanitized).not.toContain("AAHrx3xkeNiG5FakeTokenValue-abc123");
    expect(sanitized).toContain("[redacted-token]");
    expect(sanitized).toContain("unauthorized");
  });

  it("passes a plain message through unchanged", () => {
    const message = "connect ETIMEDOUT after 3 attempts (last status 503)";
    expect(sanitizeAlertError(message)).toBe(message);
  });
});

describe("buildAlertContextJson", () => {
  it("carries summary, description, links, and the condition", () => {
    const json = buildAlertContextJson({
      summary: "12 errors in checkout",
      description: "See runbook",
      alertLink: "https://app.example.com/alerts/rules/default/high-errors",
      runbookLink: "https://app.example.com/runbooks/default/incident",
      condition: { operator: "gt", threshold: 5, value: 12 },
    });
    expect(JSON.parse(json)).toEqual({
      summary: "12 errors in checkout",
      description: "See runbook",
      links: {
        alert: "https://app.example.com/alerts/rules/default/high-errors",
        runbook: "https://app.example.com/runbooks/default/incident",
      },
      condition: { operator: "gt", threshold: 5, value: 12 },
    });
  });

  it("omits empty values instead of writing empty keys", () => {
    const json = buildAlertContextJson({
      summary: "",
      description: undefined,
      alertLink: undefined,
      runbookLink: "",
      condition: { operator: "lt", threshold: 1, value: 0 },
    });
    expect(JSON.parse(json)).toEqual({
      condition: { operator: "lt", threshold: 1, value: 0 },
    });
  });
});
