/** Physical product routes for tests that keep topology but replace page bodies. */
export const productRouteFiles = Object.keys(
  import.meta.glob("../routes/**/*.{ts,tsx}"),
)
  .filter(
    (path) =>
      !/\.test\.[^.]+$/.test(path) &&
      path
        .split("/")
        .every(
          (segment) => !segment.startsWith("-") || segment.startsWith("-_"),
        ),
  )
  .map((path) => new URL(path, import.meta.url).pathname);

const moduleReference = (path: string) =>
  new URL(path, import.meta.url).pathname;

/** Opaque module references for preserving real routes in composed router tests. */
export const sharedRouteModules = {
  welcome: moduleReference("../routes/-_welcome.tsx"),
  guest: moduleReference("../routes/_welcome/_guest.tsx"),
  signup: moduleReference("../routes/_welcome/_guest/auth/sign-up.tsx"),
  invitation: moduleReference("../routes/_welcome/invite.$invitationId.tsx"),
  home: moduleReference(
    "../routes/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/index.tsx",
  ),
  root: moduleReference("../routes/__root.tsx"),
  authenticated: moduleReference("../routes/-_authenticated.tsx"),
  organization: moduleReference("../routes/_authenticated/-_organization.tsx"),
  access: moduleReference(
    "../routes/_authenticated/_organization/_dashboard/_appAccess.tsx",
  ),
  provisioned: moduleReference(
    "../routes/_authenticated/_organization/_dashboard/_appAccess/_provisioned.tsx",
  ),
  signedIn: moduleReference("../routes/_welcome/-_signedIn.tsx"),
  logs: moduleReference(
    "../routes/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/logs.tsx",
  ),
  device: moduleReference("../routes/_authenticated/_organization/device.tsx"),
};
