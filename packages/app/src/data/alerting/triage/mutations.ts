/** The Alert rule state command the triage screen makes. */
import * as z from "zod";
import { loadRule } from "@/data/alerting/rules/read";
import { pauseRule, resumeRule } from "@/data/alerting/rules/repository";
import { alertingMutationScope } from "@/data/alerting/session";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

/**
 * Pausing and silencing are different acts and the surface must not blur them:
 * a silenced rule keeps evaluating and keeps its state, a paused one stops
 * being evaluated and has its rollup and health reset. Both take the rule by
 * its as-code path, because that is the only identity the screen knows.
 */
export const setAlertRulePaused = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ path: z.string(), paused: z.boolean() }))
  .handler(async ({ data, context }) => {
    const scope = alertingMutationScope(context.session);
    const { id } = await loadRule(scope.organizationId, data.path);
    await (data.paused ? pauseRule(scope, id) : resumeRule(scope, id));
    return { paused: data.paused };
  });
