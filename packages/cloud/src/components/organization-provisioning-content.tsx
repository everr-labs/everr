import type { ReactNode } from "react";

export function OrganizationProvisioningContent({
  children,
  checkout = false,
  pending = true,
  failed = false,
  takingLonger = false,
}: {
  children?: ReactNode;
  checkout?: boolean;
  pending?: boolean;
  failed?: boolean;
  takingLonger?: boolean;
}) {
  if (failed) {
    return (
      <ProvisioningView
        label={
          checkout ? "Your Pro organization" : "Setting up your organization"
        }
        title="We couldn't finish setting up your organization"
        description="Please try again."
        pending={false}
      >
        {children}
      </ProvisioningView>
    );
  }

  if (checkout) {
    return (
      <ProvisioningView
        label="Your Pro organization"
        title="Taking you to checkout"
        description="The checkout page will open automatically."
        pending={pending}
      >
        {children}
      </ProvisioningView>
    );
  }

  return (
    <ProvisioningView
      label="Setting up your organization"
      title="Getting your space ready"
      description="We're setting up your organization. You'll be taken into Everr when it's ready."
      notice={
        takingLonger ? (
          <>
            Setup is taking a little longer than expected, but we're still
            working on it. We'll email you as soon as your organization is
            ready, so you can safely leave this page. In the meantime, you can{" "}
            <a
              href="https://everr.dev/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              explore the documentation
            </a>{" "}
            or{" "}
            <a
              href="mailto:hello@everr.dev"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              contact us
            </a>{" "}
            if you have any questions.
          </>
        ) : null
      }
      pending={pending}
    >
      {children}
    </ProvisioningView>
  );
}

function ProvisioningView({
  label,
  title,
  description,
  pending,
  notice,
  children,
}: {
  label: string;
  title: string;
  description: string;
  pending: boolean;
  notice?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p
          className="text-sm leading-relaxed text-muted-foreground"
          role="status"
        >
          {description}
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
        {notice && (
          <p
            className="text-sm leading-relaxed text-muted-foreground"
            role="status"
          >
            {notice}
          </p>
        )}
      </div>
      {children}
    </>
  );
}
