import type {
  ErrorsRepositoryLike,
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "@everr/telemetry-explorer/errors";
import { getErrorIssue, listErrorServices, searchErrorIssues } from "./server";

export const remoteErrorsRepo: ErrorsRepositoryLike = {
  searchIssues: (input: SearchErrorIssuesInput) =>
    searchErrorIssues({ data: input }),
  getIssue: (input: GetErrorIssueInput) => getErrorIssue({ data: input }),
  listServices: (input: ListErrorServicesInput) =>
    listErrorServices({ data: input }),
};
