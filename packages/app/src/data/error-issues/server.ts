import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import { alertingMutationScope } from "../alerting/session";
import {
  disableErrorIssues,
  type ErrorIssuesState,
  ErrorIssuesSettingsSchema,
  enableErrorIssues,
  getErrorIssues,
  listEnvironments,
  type TrackedErrorIssue,
  trackedErrorIssues,
} from "./automation.server";

export const getErrorIssuesState = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }): Promise<ErrorIssuesState> =>
    getErrorIssues(context.session.session.activeOrganizationId),
);

export const getErrorIssueEnvironments = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }): Promise<string[]> =>
    listEnvironments(context.session.session.activeOrganizationId),
);

export const getTrackedErrorIssues = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }): Promise<Record<string, TrackedErrorIssue>> =>
    trackedErrorIssues(context.session.session.activeOrganizationId),
);

export const turnOnErrorIssues = createAuthenticatedServerFn({ method: "POST" })
  .validator(ErrorIssuesSettingsSchema)
  .handler(({ data, context: { session } }) =>
    enableErrorIssues(alertingMutationScope(session), data),
  );

export const turnOffErrorIssues = createAuthenticatedServerFn({ method: "POST" }).handler(
  ({ context: { session } }) => disableErrorIssues(alertingMutationScope(session)),
);
