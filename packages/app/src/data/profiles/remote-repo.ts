import type { ProfilesRepositoryLike } from "@everr/telemetry-explorer/profiles";
import {
  getProfileAttributeKeys,
  getProfileAttributeValues,
  getProfileExampleTraces,
  getProfileHistogram,
  getProfileSpanTimeline,
  listProfiledSpans,
  getProfileStacks,
  listProfileSampleTypes,
  listProfileServices,
  listProfileVersions,
} from "./server";

export const remoteProfilesRepo: ProfilesRepositoryLike = {
  listServices: (input) => listProfileServices({ data: input }),
  listSampleTypes: (input) => listProfileSampleTypes({ data: input }),
  stacks: (input) => getProfileStacks({ data: input }),
  listVersions: (input) => listProfileVersions({ data: input }),
  exampleTraces: (input) => getProfileExampleTraces({ data: input }),
  histogram: (input) => getProfileHistogram({ data: input }),
  spanTimeline: (input) => getProfileSpanTimeline({ data: input }),
  profiledSpans: (input) => listProfiledSpans({ data: input }),
  attributeKeys: (input) => getProfileAttributeKeys({ data: input }),
  attributeValues: (input) => getProfileAttributeValues({ data: input }),
};
