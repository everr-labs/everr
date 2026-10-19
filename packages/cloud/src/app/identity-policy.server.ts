import type { IdentityPolicy } from "@everr/app/composition";
import { billing } from "../billing/server";
import { assertAccountDeletionAllowed } from "./account";

export const identityPolicy: IdentityPolicy = {
  async beforeUserCreate() {},
  assertAccountDeletionAllowed,
  beforeUserDelete: billing.beforeUserDelete,
  beforeMembershipChange: billing.beforeMembershipChange,
  afterMembershipChange: billing.afterMembershipChange,
  assertDeletable: billing.assertDeletable,
};
