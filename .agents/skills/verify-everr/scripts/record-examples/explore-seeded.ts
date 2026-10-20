// verify-everr web-record example: the seeded Explore pages after `web-seed`.
// Run: $V web-record --steps .agents/skills/verify-everr/scripts/record-examples/explore-seeded.ts
// Generic on purpose: everything comes from the recorder (r.base = this run's web origin) and the
// constants web-seed uses, so it works in any web run that ran web-auth.md Sign up and web-seed.
// Copy it next to your evidence and edit it for a PR-specific journey; do not hardcode ports or paths.
import type { Recorder } from "../record.ts";

const SERVICE = "verify-seed-api";
const svc = `service=${encodeURIComponent(JSON.stringify([SERVICE]))}`;

export default async (r: Recorder) => {
  const { page } = r;

  r.step("logs");
  await page.goto(`${r.base}/logs?${svc}`);
  await page.getByText("verify-seed: charge failed").first().waitFor();
  await r.caption(`Logs filtered to ${SERVICE}: the 3 seeded records`);
  await page.getByText("Showing all 3 matching events").waitFor();
  await r.hold(2000);
  await r.frame("logs");

  r.step("traces");
  await page.goto(`${r.base}/traces?${svc}`);
  await page.getByText("/checkout").first().waitFor();
  await r.caption("Traces: one POST /checkout trace with status Error");
  await r.hold(1500);
  await page.getByText("/checkout").first().click();
  await page.getByText("charge card").first().waitFor();
  await r.caption("Trace detail: 3 spans, the failing charge highlighted", { tone: "good" });
  await r.hold(2500);
  await r.frame("trace");

  r.step("errors");
  await page.goto(`${r.base}/errors?${svc}`);
  await page.getByText("VerifySeedPaymentError").first().waitFor();
  await r.caption("Errors: the exception log grouped as VerifySeedPaymentError", { tone: "good" });
  await r.hold(2500);
  await r.frame("errors");
  // Keep a second after the last frame: a frame at the very end of the video cannot be extracted.
  await r.hold(1000);
  await r.caption("");
};
