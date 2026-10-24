import { z } from "zod";

// Missing version means the original persisted payload. Keep accepting it
// during rolling deploys and when retrying jobs from before versioning.
export const organizationLifecyclePayloadSchema = z.object({
  version: z.literal(1).default(1),
  organizationId: z.string().min(1),
});
