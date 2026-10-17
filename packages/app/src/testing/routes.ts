/** Physical product routes for tests that keep topology but replace page bodies. */
export const productRouteFiles = Object.keys(
  import.meta.glob("../routes/**/*.{ts,tsx}"),
).map((path) => new URL(path, import.meta.url).pathname);

const moduleReference = (path: string) =>
  new URL(path, import.meta.url).pathname;

/** Opaque module references for preserving real guards in composed router tests. */
export const sharedRouteModules = {
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
  device: moduleReference("../routes/_authenticated/_organization/device.tsx"),
};
