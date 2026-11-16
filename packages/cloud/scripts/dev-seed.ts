// Development only: the Cloud seed entry point for `pnpm dev`.
import { runDevSeed } from "@everr/app/dev-seed";
import { generateOrgSlug } from "../src/common/organization-name.ts";

await runDevSeed("cloud", async ({ db, auth, email, password }) => {
  const [{ eq }, { user }] = await Promise.all([
    import("drizzle-orm"),
    import("@everr/app/db/schema"),
  ]);
  // The internal adapter skips the sign-up endpoint's verification email.
  // Cloud's worker provisions the organization's ClickHouse access once the
  // server starts. A user left without an organization is reused.
  const context = await auth.$context;
  let [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!existing) {
    existing = await context.internalAdapter.createUser(
      { email, name: "Everr Dev", emailVerified: true },
      { method: "email-password" },
    );
    await context.internalAdapter.linkAccount({
      userId: existing.id,
      providerId: "credential",
      accountId: existing.id,
      password: await context.password.hash(password),
    });
  }
  await auth.api.createOrganization({
    body: { name: "Everr Dev", slug: generateOrgSlug(), userId: existing.id },
  });
});
