/**
 * The writes the triage screen makes. Each parses its input and hands the act
 * to the repository that owns it: releasing held events, resetting a rule's
 * instances and re-enqueueing its evaluation are the engine's business, not
 * the screen's.
 */
import * as z from "zod";
import { pauseRule, resumeRule } from "@/data/alerting/rules/repository";
import { alertingMutationScope } from "@/data/alerting/session";
import {
  createSilence,
  expireSilence,
} from "@/data/alerting/silences/repository";
import type { AlertingMatcher } from "@/data/alerting/types";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { loadRule } from "./rules";
import { RULE_LABEL } from "./silences";

/** Free-form `key=value` pairs, space or comma separated. Anything that is not
 *  a pair is rejected rather than silently widening the silence. */
export function parseMatchers(input: string): AlertingMatcher[] {
  return input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const eq = token.indexOf("=");
      if (eq <= 0) throw new Error(`matcher must be label=value: ${token}`);
      return {
        label: token.slice(0, eq),
        op: "eq" as const,
        value: token.slice(eq + 1),
      };
    });
}

export const silenceAlertRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      path: z.string(),
      durationMinutes: z
        .number()
        .int()
        .positive()
        .max(60 * 24 * 30),
      matchers: z.string().default(""),
      comment: z.string().max(500).default(""),
    }),
  )
  .handler(async ({ data, context }) => {
    const scope = alertingMutationScope(context.session);
    // The rule has to exist in this org before anything is muted by its name,
    // and the path has to be one before it reaches the database. Same
    // resolution as pausing: the two must not disagree about what a path is.
    await loadRule(scope.organizationId, data.path);
    const now = new Date();
    const silence = await createSilence(scope, {
      // The rule matcher is always present: a silence with only instance
      // matchers would mute that label across every rule in the org.
      matchers: [
        { label: RULE_LABEL, op: "eq", value: data.path },
        ...parseMatchers(data.matchers),
      ],
      starts_at: now.toISOString(),
      ends_at: new Date(
        now.getTime() + data.durationMinutes * 60_000,
      ).toISOString(),
      comment: data.comment,
    });
    return { id: silence.id };
  });

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

export const expireAlertSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    return expireSilence(alertingMutationScope(context.session), data.id);
  });
