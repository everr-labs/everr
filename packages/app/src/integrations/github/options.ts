import { queryOptions } from "@tanstack/react-query";
import { getGithubAvailability } from "./data";

export const githubAvailabilityOptions = queryOptions({
  queryKey: ["integrations", "github", "availability"],
  queryFn: () => getGithubAvailability(),
  staleTime: Infinity,
});
