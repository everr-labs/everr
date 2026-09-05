/**
 * Silence commands at the server seam. Rule identity and matcher invariants
 * are resolved here before the existing PostgreSQL adapter is called.
 */
import * as z from "zod";
import { loadRule } from "@/data/alerting/rules/read";
import { alertingMutationScope } from "@/data/alerting/session";
import { parseMatchers } from "@/data/alerting/silences/matchers";
import {
  createSilence,
  expireSilence,
} from "@/data/alerting/silences/repository";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

export const createAlertSilence = createAuthenticatedServerFn({
  method: "POST",
})
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
    // The rule has to exist in this org before anything is muted by its name.
    const rule = await loadRule(scope.organizationId, data.path);
    const now = new Date();
    const silence = await createSilence(scope, {
      // The rule matcher is always present. Without it, instance matchers
      // would mute the same labels across every Alert rule in the org.
      matchers: [
        { label: "rule", op: "eq", value: rule.id },
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

/** Cancel closes the window early; natural expiry remains a separate fact. */
export const cancelAlertSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data, context }) =>
    expireSilence(alertingMutationScope(context.session), data.id),
  );
