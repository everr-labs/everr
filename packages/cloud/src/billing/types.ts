import type { Database } from "@everr/app/db/client";

export type Person = { id: string; name: string; email: string };
export type Customer = { id: string; externalId?: string | null; type: string };
export type BillingMember = {
  id: string;
  customerId: string;
  externalId: string | null;
  email: string;
  name: string | null;
  role: "owner" | "billing_manager" | "member";
};
export type Metadata = Record<string, string | number | boolean>;
export type Checkout = {
  id: string;
  status: string;
  url: string;
  successUrl: string | null;
  expiresAt: Date;
  customerId: string | null;
  externalCustomerId: string | null;
  productId: string | null;
  subscriptionId: string | null;
  metadata: Metadata;
};
export type Subscription = {
  id: string;
  customerId: string;
  checkoutId: string | null;
  productId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  modifiedAt: Date | null;
  createdAt: Date;
};
export type SubscriptionEvent = {
  data: Subscription & {
    metadata: Metadata;
    customer: { id: string; externalId?: string | null };
  };
};
export type CreateOrganization = (input: {
  body: { name: string; slug: string; userId: string };
}) => Promise<unknown>;
export interface PolarGateway {
  findCustomer(this: void, orgId: string): Promise<Customer | null>;
  getCustomer(this: void, id: string): Promise<Customer>;
  createTeam(
    this: void,
    input: {
      orgId: string;
      name: string;
      owner: Person;
    },
  ): Promise<Customer>;
  members(this: void, customerId: string): Promise<BillingMember[]>;
  createMember(this: void, customerId: string, person: Person): Promise<BillingMember>;
  updateMember(
    this: void,
    customerId: string,
    id: string,
    input: { name?: string; email?: string; role?: BillingMember["role"] },
  ): Promise<BillingMember>;
  deleteMember(this: void, customerId: string, id: string): Promise<void>;
  portal(this: void, customerId: string, memberId: string): Promise<string>;
  checkout(this: void, id: string): Promise<Checkout>;
  checkouts(this: void, customerId: string): Promise<Checkout[]>;
  createCheckout(
    this: void,
    input: {
      customerId: string;
      orgId: string;
      metadata: Metadata;
      successUrl: string;
    },
  ): Promise<Checkout>;
  updateCheckoutSuccessUrl(this: void, id: string, successUrl: string): Promise<Checkout>;
  subscription(this: void, id: string): Promise<Subscription>;
  checkoutSubscription(this: void, checkout: Checkout): Promise<Subscription | null>;
  revokeSubscription(this: void, id: string): Promise<void>;
}
export type BillingDependencies = {
  db: Database;
  polar: PolarGateway;
  lock: <T>(key: string, run: () => Promise<T>) => Promise<T>;
  appUrl: string;
};
export type BillingErrorCode =
  | "already_active"
  | "unavailable"
  | "identity_conflict"
  | "customer_missing"
  | "owner_required"
  | "forbidden"
  | "unsupported_checkout";
export class BillingError extends Error {
  name = "BillingError";
  constructor(
    public readonly code: BillingErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
