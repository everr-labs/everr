export const INVITATION_EMAIL_HEADER = "x-everr-send-invitation-email";

export function invitationUrl(id: string, baseUrl: string) {
  return new URL(`/invite/${encodeURIComponent(id)}`, baseUrl).toString();
}
