import type {
  AttributeKey,
  ErrorAttributeKeysInput,
  ErrorAttributeValuesInput,
  ErrorsRepositoryLike,
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "@everr/telemetry-explorer/errors";
import {
  getErrorAttributeKeys,
  getErrorAttributeValues,
  getErrorIssue,
  listErrorServices,
  searchErrorIssues,
} from "./server";

export const remoteErrorsRepo: ErrorsRepositoryLike = {
  searchIssues: (input: SearchErrorIssuesInput) => searchErrorIssues({ data: input }),
  getIssue: (input: GetErrorIssueInput) => getErrorIssue({ data: input }),
  listServices: (input: ListErrorServicesInput) => listErrorServices({ data: input }),
  attributeKeys: (input: ErrorAttributeKeysInput): Promise<AttributeKey[]> =>
    getErrorAttributeKeys({ data: input }),
  attributeValues: (input: ErrorAttributeValuesInput): Promise<string[]> =>
    getErrorAttributeValues({ data: input }),
};
