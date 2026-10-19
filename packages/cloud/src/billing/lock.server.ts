import { pool } from "@everr/app/db/client";
import { createLockPool } from "@everr/app/db/database";
import { createBillingRequestLocks } from "./request-locks";

export const { withBillingRequest, withCheckoutLock, lockAccountDeletion } =
  createBillingRequestLocks(createLockPool(pool.options));
