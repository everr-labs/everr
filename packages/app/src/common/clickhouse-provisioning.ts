export const CLICKHOUSE_SETUP_MESSAGE =
  "We're setting up your organization's data access. This is taking a little longer than usual. We'll keep trying automatically. Please try again shortly.";

export class ClickhouseProvisioningPendingError extends Error {
  name = "ClickhouseProvisioningPendingError";

  constructor() {
    super(CLICKHOUSE_SETUP_MESSAGE);
  }
}
