import type { ApplicationServer } from "@everr/app/composition";

export const server: ApplicationServer = {
  getIngestEndpoint: () => "https://ingest.everr.dev/",
  async assertAccountDeletionAllowed(organizations) {
    const { assertAccountDeletionAllowed } = await import("./app/account");
    return assertAccountDeletionAllowed(organizations);
  },
  async getEntryRedirect(pathname) {
    if (pathname === "/setup") return { to: "/" };
  },
  async canOpenSignup() {
    return true;
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("./app/migrations");
    return migrateDatabase(database);
  },
  async startAppWorkers() {
    const { startOrganizationWorker } = await import(
      "./organization-provisioning/worker"
    );
    return startOrganizationWorker();
  },
};
