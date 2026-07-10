import type {
  AttributeKey,
  ErrorAttributeKeysInput,
  ErrorAttributeValuesInput,
  ErrorsRepositoryLike,
  GetErrorIssueInput,
  ListErrorServicesInput,
  ListErrorTriageEventsInput,
  SearchErrorIssuesInput,
} from "@everr/telemetry-explorer/errors";
import {
  getErrorAttributeKeys,
  getErrorAttributeValues,
  getErrorIssue,
  listErrorServices,
  listErrorTriageEvents,
  searchErrorIssues,
} from "./server";

export const remoteErrorsRepo: ErrorsRepositoryLike = {
  // Mirrors the server-side repository construction: the cloud has the triage
  // events table, so summaries carry derived Status.
  triageEvents: true,
  searchIssues: (input: SearchErrorIssuesInput) =>
    searchErrorIssues({ data: input }),
  getIssue: (input: GetErrorIssueInput) => getErrorIssue({ data: input }),
  listTriageEvents: (input: ListErrorTriageEventsInput) =>
    listErrorTriageEvents({ data: input }),
  listServices: (input: ListErrorServicesInput) =>
    listErrorServices({ data: input }),
  attributeKeys: (input: ErrorAttributeKeysInput): Promise<AttributeKey[]> =>
    getErrorAttributeKeys({ data: input }),
  attributeValues: (input: ErrorAttributeValuesInput): Promise<string[]> =>
    getErrorAttributeValues({ data: input }),
};
