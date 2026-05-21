import { z } from "zod";

// better-auth's getFullOrganization returns metadata as a raw JSON string
// straight from the DB, but tests and some callers pass objects — accept both.
export const OrgMetadataSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value ?? {};
  },
  z.looseObject({ onboardingCompleted: z.boolean().optional() }),
);
