import "@tanstack/react-start/server-only";
import { product } from "@composition/product";
import { db } from "#app/db/client.ts";
import { env } from "#app/env/index.ts";
import { socialProviders } from "#app/lib/auth-providers.server.ts";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "#app/lib/email.server.tsx";
import { mailer } from "#app/lib/mailer.server.ts";
import { events } from "#app/server/events/runtime.ts";
import { createApplicationAuth } from "./module";

const { identity } = await import("@composition/identity");
export const auth = createApplicationAuth(identity, {
  database: db,
  events,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  socialProviders,
  email: {
    enabled: mailer !== null,
    sendInvitation: sendInvitationEmail,
    sendPasswordReset: sendPasswordResetEmail,
    sendVerification: sendVerificationEmail,
  },
  canInviteMembers: (organizationId) => product.canInviteMembers(organizationId),
});
