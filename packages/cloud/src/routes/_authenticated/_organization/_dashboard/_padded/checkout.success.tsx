import { authClient } from "@everr/app/identity/client";
import { resetRouteAccess } from "@everr/app/lib/route-access-cache";
import { Button, buttonVariants } from "@everr/ui/components/button";
import { EverrLogoMark } from "@everr/ui/components/everr-logo";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarCheck,
  Check,
  Copy,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Lock,
  type LucideIcon,
  Mail,
  RotateCw,
  Users,
} from "lucide-react";
import { type ReactElement, type ReactNode, useRef } from "react";
import * as z from "zod";
import { confirmOrgCheckout } from "../../../../../data/billing";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_padded/checkout/success",
)({
  staticData: { breadcrumb: "Checkout", hideTimeRangePicker: true },
  validateSearch: SearchSchema,
  head: () => ({
    meta: [{ title: "Everr - Checkout complete" }],
  }),
  component: CheckoutSuccessPage,
});

type Phase = "pending" | "completed" | "billing_conflict" | "unavailable";

const SUPPORT_EMAIL = "hello@everr.dev";
const RING_CIRCUMFERENCE = 2 * Math.PI * 55;
const EASE_OUT = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const ENTER = cn(
  "animate-in fade-in slide-in-from-bottom-[6px] fill-mode-both duration-300 motion-reduce:slide-in-from-bottom-0",
  EASE_OUT,
);

function CheckoutSuccessPage(): ReactElement {
  const { checkout_id } = Route.useSearch();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const confirmation = useQuery({
    queryKey: ["organization-checkout", checkout_id],
    enabled: Boolean(checkout_id),
    queryFn: async ({ client }) => {
      const result = await confirmOrgCheckout({
        data: { checkoutId: checkout_id ?? "" },
      });
      if (result.status === "completed") {
        // The plan decides app access and which pages the organization gets.
        resetRouteAccess(client);
        await client.invalidateQueries({
          queryKey: ["organization-creation-options"],
        });
      }
      return result;
    },
    refetchInterval: (query) =>
      query.state.status === "error" || (query.state.data && query.state.data.status !== "pending")
        ? false
        : 1_000,
    retry: 3,
  });
  const phase: Phase =
    confirmation.data?.status === "completed"
      ? "completed"
      : confirmation.data?.status === "billing_conflict"
        ? "billing_conflict"
        : !checkout_id || (confirmation.isError && !confirmation.isFetching)
          ? "unavailable"
          : "pending";
  const orgName = activeOrg?.name;

  return (
    <section className="relative isolate flex justify-center overflow-x-clip px-4 pt-[clamp(40px,8vh,96px)] pb-16">
      <div className="flex w-full max-w-[720px] flex-col items-center text-center">
        <Emblem phase={phase} />
        <div aria-live="polite">
          <h1 className="text-[clamp(30px,4.2vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-balance">
            <span
              key={phase}
              className={cn(
                ENTER,
                phase === "completed" && "everr-decoration everr-decoration-primary delay-[140ms]",
              )}
            >
              {TITLES[phase]}
            </span>
          </h1>
          <p className="mx-auto mt-3.5 max-w-[450px] text-[15.5px] leading-relaxed text-muted-foreground text-pretty">
            <span
              key={phase}
              role={phase === "billing_conflict" || phase === "unavailable" ? "alert" : undefined}
              className={cn(ENTER, phase === "completed" ? "delay-200" : "delay-[60ms]")}
            >
              {phase === "completed"
                ? `${orgName ?? "Your organization"} is now on Pro. Here's where to start.`
                : phase === "unavailable" && !checkout_id
                  ? "The subscription couldn't be confirmed. Return to billing to try the upgrade again."
                  : LEDES[phase]}
            </span>
          </p>
        </div>

        {phase === "pending" ? (
          <p
            className={cn(
              ENTER,
              "mt-6 inline-flex items-center gap-2 text-[12.5px] text-muted-foreground/70 delay-[120ms]",
            )}
          >
            <Loader2 className="size-4 animate-spin" />
            Checking every second
          </p>
        ) : null}

        {phase === "pending" || phase === "completed" ? (
          <NextSteps locked={phase === "pending"} orgName={orgName} />
        ) : null}

        {phase === "completed" ? (
          <Link
            to="/billing"
            className={cn(
              ENTER,
              "mt-5 rounded-sm text-[13px] text-muted-foreground transition-colors duration-150 delay-[560ms] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            )}
          >
            Manage billing
          </Link>
        ) : null}

        {phase === "billing_conflict" && checkout_id ? (
          <ConflictSteps checkoutId={checkout_id} orgName={orgName} />
        ) : null}

        {phase === "unavailable" ? (
          <div className={cn(ENTER, "mt-8 flex items-center gap-2 delay-[120ms]")}>
            {checkout_id ? (
              <Button size="lg" onClick={() => void confirmation.refetch()}>
                <RotateCw />
                Try again
              </Button>
            ) : null}
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link to="/billing" />}
            >
              Back to billing
            </Button>
          </div>
        ) : null}

        {checkout_id ? <CheckoutIdReference checkoutId={checkout_id} /> : null}
      </div>
    </section>
  );
}

const TITLES: Record<Phase, string> = {
  pending: "Confirming your payment",
  completed: "Welcome to Pro",
  billing_conflict: "Your payment needs attention",
  unavailable: "We couldn't confirm Pro yet",
};

const LEDES: Record<Exclude<Phase, "completed">, string> = {
  pending: "Everr is verifying the subscription with Polar. This takes a few seconds.",
  billing_conflict:
    "Polar confirmed the payment, but its billing customer doesn't match this organization.",
  unavailable: "The subscription couldn't be confirmed. Try again, or return to billing.",
};

function Emblem({ phase }: { phase: Phase }) {
  const failed = phase === "billing_conflict" || phase === "unavailable";
  return (
    <div className="relative mb-7 grid size-28 shrink-0 place-items-center">
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 -z-10 size-160 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_13%,transparent),color-mix(in_oklab,var(--primary)_4%,transparent)_55%,transparent)] transition-opacity duration-800 ease-out",
          phase === "completed" ? "opacity-100" : "opacity-0",
        )}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 112 112"
        className="absolute inset-0 size-full -rotate-90 overflow-visible fill-none"
      >
        <circle cx="56" cy="56" r="55" strokeWidth="2" className="stroke-foreground/10" />
        {phase === "pending" ? (
          <circle
            cx="56"
            cy="56"
            r="55"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="64 400"
            className="origin-center animate-spin stroke-foreground [transform-box:fill-box]"
          />
        ) : null}
        <circle
          cx="56"
          cy="56"
          r="55"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          style={{ strokeDashoffset: phase === "pending" ? RING_CIRCUMFERENCE : 0 }}
          className={cn(
            "transition-[stroke-dashoffset] duration-600 motion-reduce:transition-none",
            EASE_OUT,
            failed ? "stroke-destructive" : "stroke-primary",
          )}
        />
      </svg>
      <EverrLogoMark
        className={cn(
          "size-14 transition-opacity duration-400 ease-out",
          phase === "completed" ? "opacity-100" : "opacity-55",
        )}
      />
      {phase === "completed" ? (
        <span
          aria-hidden="true"
          className="absolute -right-2.5 bottom-1 grid h-6 place-items-center rounded-full bg-primary px-2.5 text-[11px] font-bold tracking-[0.1em] text-primary-foreground ring-4 ring-background animate-in fade-in zoom-in-50 fill-mode-both duration-[340ms] delay-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        >
          PRO
        </span>
      ) : null}
      {failed ? (
        <span
          aria-hidden="true"
          className="absolute -right-2.5 bottom-1 grid size-6 place-items-center rounded-full bg-destructive text-[11px] font-bold text-background ring-4 ring-background animate-in fade-in zoom-in-50 fill-mode-both duration-[340ms] delay-[220ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        >
          !
        </span>
      ) : null}
    </div>
  );
}

type NextStep = {
  icon: LucideIcon;
  title: string;
  description: string;
} & ({ to: "/users-management" | "/dashboards" } | { href: string });

function nextSteps(orgName: string | undefined): NextStep[] {
  return [
    {
      icon: CalendarCheck,
      title: "Book white-glove onboarding",
      description: `Pair with the Everr team to set up telemetry, dashboards, and alerts for ${orgName ?? "your organization"}.`,
      href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Pro onboarding")}`,
    },
    {
      icon: LifeBuoy,
      title: "Premium support",
      description: "Email the Everr team directly with questions or incidents.",
      href: `mailto:${SUPPORT_EMAIL}`,
    },
    {
      icon: Users,
      title: "Invite your team",
      description: "Add teammates so everyone works from the same signal.",
      to: "/users-management",
    },
    {
      icon: LayoutDashboard,
      title: "Open dashboards",
      description: "Pick up your services where you left them.",
      to: "/dashboards",
    },
  ];
}

// While the payment is confirming the cards show what Pro unlocks; once it is
// confirmed they unlock one after another, after the ring has drawn.
function NextSteps({ locked, orgName }: { locked: boolean; orgName: string | undefined }) {
  return (
    <ul className="mt-10 grid w-full gap-3 sm:grid-cols-2">
      {nextSteps(orgName).map((step, index) => (
        <li
          key={step.title}
          className={cn(
            "flex transition-opacity duration-350 ease-out",
            locked ? "opacity-40" : "opacity-100",
          )}
          style={locked ? undefined : { transitionDelay: `${320 + index * 50}ms` }}
        >
          <NextStepCard step={step} locked={locked} />
        </li>
      ))}
    </ul>
  );
}

function NextStepCard({ step, locked }: { step: NextStep; locked: boolean }) {
  const Icon = step.icon;
  const className =
    "group relative flex w-full gap-3.5 rounded-xl border bg-card/60 p-4 pr-11 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:border-foreground/15 hover:bg-card active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:pointer-events-none";
  const lockProps = locked ? { "aria-disabled": true, tabIndex: -1 } : {};
  const content: ReactNode = (
    <>
      <span className="grid size-8.5 shrink-0 place-items-center rounded-lg bg-muted/60">
        <Icon className="size-4.5" />
      </span>
      <span>
        <span className="block text-sm font-medium">{step.title}</span>
        <span className="mt-0.5 block text-[13px] leading-normal text-muted-foreground text-pretty">
          {step.description}
        </span>
      </span>
      <span className="absolute top-4 right-4 text-muted-foreground/70 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground">
        {locked ? <Lock className="size-4" /> : <ArrowUpRight className="size-4" />}
      </span>
    </>
  );

  return "to" in step ? (
    <Link to={step.to} className={className} {...lockProps}>
      {content}
    </Link>
  ) : (
    <a href={step.href} className={className} {...lockProps}>
      {content}
    </a>
  );
}

function ConflictSteps({
  checkoutId,
  orgName,
}: {
  checkoutId: string;
  orgName: string | undefined;
}) {
  const steps: { title: string; description: ReactNode }[] = [
    {
      title: "Don't repeat the purchase",
      description: "Polar already has the payment, so a second checkout would charge you again.",
    },
    {
      title: "Send support the checkout ID",
      description: (
        <>
          Email {SUPPORT_EMAIL} with{" "}
          <span className="font-mono text-xs break-all text-foreground">{checkoutId}</span>.
        </>
      ),
    },
    {
      title: `We link the payment to ${orgName ?? "your organization"}`,
      description: "Pro turns on once the billing customer is reconciled.",
    },
  ];
  const supportHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    "Billing conflict after upgrading to Pro",
  )}&body=${encodeURIComponent(`Checkout ID: ${checkoutId}`)}`;

  return (
    <section
      className={cn(
        ENTER,
        "mt-8 grid w-full max-w-[560px] gap-4.5 rounded-2xl border bg-card/60 p-5 text-left delay-[120ms]",
      )}
    >
      <ol className="grid gap-3.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium leading-5.5">{step.title}</p>
              <p className="text-[13px] text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <a href={supportHref} className={buttonVariants({ size: "lg" })}>
          <Mail />
          Email support
        </a>
        <CopyCheckoutIdButton checkoutId={checkoutId} />
      </div>
    </section>
  );
}

function CopyCheckoutIdButton({ checkoutId }: { checkoutId: string }) {
  const { state, copy } = useCopyToClipboard(checkoutId);
  return (
    <Button size="lg" variant="outline" onClick={copy}>
      {state === "copied" ? <Check className="text-primary" /> : <Copy />}
      {state === "copied" ? "Copied" : "Copy checkout ID"}
    </Button>
  );
}

function CheckoutIdReference({ checkoutId }: { checkoutId: string }) {
  const idRef = useRef<HTMLSpanElement>(null);
  const { state, copy } = useCopyToClipboard(checkoutId, { selectOnFailure: idRef });
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy checkout ID"
      className="mt-10 inline-flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[11.5px] text-muted-foreground/70 transition-colors duration-150 ease-out hover:bg-muted/40 hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span>
        Checkout <span ref={idRef}>{checkoutId}</span>
      </span>
      {state === "copied" ? (
        <Check className="size-3.5 text-primary" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}
