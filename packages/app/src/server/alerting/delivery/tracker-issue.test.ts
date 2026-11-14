import { describe, expect, it } from "vite-plus/test";
import { type TrackerIssueInput, trackerIssueBody, trackerIssueTitle } from "./tracker-issue";

const INPUT: TrackerIssueInput = {
  rulePath: "default/new-errors",
  ruleName: "New production errors",
  severity: "warning",
  title: "",
  description: "",
  labels: { service: "checkout" },
  evidence: {},
  occurredAt: new Date("2026-11-14T10:00:00Z"),
};

describe("an alert issue", () => {
  it("is titled by the rule's summary, or by the rule and its labels when there is none", () => {
    expect(trackerIssueTitle({ ...INPUT, title: "TypeError in checkout" })).toBe(
      "TypeError in checkout",
    );
    expect(trackerIssueTitle(INPUT)).toBe("New production errors: service=checkout");
  });

  it("keeps evidence values from breaking out of their table cell", () => {
    const body = trackerIssueBody({
      ...INPUT,
      evidence: { message: "a | b with `code` inside" },
    });
    const row = body.split("\n").find((line) => line.includes("message"));
    expect(row).toBe("| `message` | ``a \\| b with `code` inside`` |");
  });

  it("shows a stack trace with its line breaks, and leaves empty columns out", () => {
    const stacktrace =
      "TypeError: x is undefined\n    at pay (cart.ts:12)\n    at main (index.ts:3)";
    const body = trackerIssueBody({
      ...INPUT,
      evidence: { service: "checkout", repository_url: "", stacktrace },
    });
    expect(body).toContain(`### \`stacktrace\`\n\n\`\`\`\n${stacktrace}\n\`\`\``);
    expect(body).toContain("| `service` | `checkout` |");
    expect(body).not.toContain("repository_url");
  });

  it("links the alert and its runbook", () => {
    const body = trackerIssueBody({
      ...INPUT,
      alertLink: "https://app.everr.dev/alerts?alert=default/new-errors",
      runbookLink: "https://app.everr.dev/runbooks/default/errors",
    });
    expect(body).toContain(
      "[Open the alert in Everr](https://app.everr.dev/alerts?alert=default/new-errors)",
    );
    expect(body).toContain("[Runbook](https://app.everr.dev/runbooks/default/errors)");
  });
});
