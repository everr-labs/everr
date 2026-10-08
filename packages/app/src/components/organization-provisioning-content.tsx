import type { ReactNode } from "react";

export function OrganizationProvisioningContent({
  children,
  checkout = false,
  pending = true,
}: {
  children?: ReactNode;
  checkout?: boolean;
  pending?: boolean;
}) {
  return (
    <>
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground">
          {checkout ? "Your Pro organization" : "Setting up your organization"}
        </div>
        <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {checkout ? "Taking you to checkout" : "Getting your space ready"}
        </h1>
        <p
          className="text-sm leading-relaxed text-muted-foreground"
          role="status"
        >
          {checkout
            ? "Your checkout will open automatically. You'll confirm your Pro subscription there, and your organization will be created after payment is confirmed."
            : "We're setting up your organization. You'll be taken into Everr automatically when it's ready."}
        </p>
        {pending && (
          <div
            className="flex items-center justify-center gap-2 pt-2"
            aria-hidden="true"
          >
            {[0, 160, 320].map((delay) => (
              <span
                key={delay}
                className="size-2 rounded-full bg-primary opacity-40 motion-safe:animate-setup-dot motion-reduce:opacity-70"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        )}
      </div>
      {children}
    </>
  );
}
