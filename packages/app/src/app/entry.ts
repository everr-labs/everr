import { getInstallation } from "./installation.server";

export async function getAppEntry() {
  return { setupRequired: !(await getInstallation()) };
}
