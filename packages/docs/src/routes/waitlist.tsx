import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { usePostHog } from "@posthog/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Footer } from "@/components/footer";

export const Route = createFileRoute("/waitlist")({
  component: Waitlist,
  head: () => ({
    meta: [{ title: "Join the Waitlist - Everr" }],
  }),
});

function Waitlist() {
  return (
    <>
      <main className="relative z-0 flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-[140px]">
          <div className="flex flex-col items-center">
            <WaitlistHero />
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

function WaitlistHero() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const posthog = usePostHog();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }

      posthog.capture("waitlist_joined", { email: email.trim() });
      setState("success");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      posthog.capture("waitlist_join_error", {
        email: email.trim(),
        error: message,
      });
      setState("error");
      setErrorMessage(message);
    }
  }

  if (state === "success") {
    return (
      <section className="flex flex-col items-center">
        <h1 className="font-heading text-center text-5xl uppercase leading-[0.9] sm:text-7xl md:text-[100px] lg:text-[128px] everr-decoration everr-decoration-primary">
          You&apos;re in
        </h1>

        <p className="mt-6 text-center text-xl sm:text-2xl md:mt-10">
          <span
            className="inline bg-primary px-3 py-1 font-semibold font-heading text-primary-foreground leading-relaxed"
            style={{
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            Thanks for joining the waitlist.
          </span>
        </p>

        <p className="mx-auto mt-4 max-w-2xl text-center text-fd-muted-foreground">
          We&apos;ll reach out when it&apos;s your turn. In the meantime, keep
          shipping.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col items-center">
      <h1 className="font-heading text-center text-5xl uppercase leading-[0.9] sm:text-7xl md:text-[100px] lg:text-[128px]">
        Join the
        <br />
        <span className="relative inline-block px-4">
          <span className="absolute inset-x-0 top-0 bottom-0 bg-primary" />
          <span className="relative text-primary-foreground everr-decoration">
            waitlist
          </span>
        </span>
      </h1>

      <p className="mt-6 text-center text-xl sm:text-2xl md:mt-10">
        <span
          className="inline bg-primary px-3 py-1 font-semibold font-heading text-primary-foreground leading-relaxed"
          style={{
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          Be the first to know.
        </span>
      </p>

      <p className="mx-auto mt-4 max-w-2xl text-center text-fd-muted-foreground">
        Everr is coming soon. Drop your email and we&apos;ll let you know when
        it&apos;s ready.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-10 w-full max-w-md items-center gap-2 sm:gap-4 flex md:mt-14"
      >
        <Input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-14 w-full flex-1 border-2 border-fd-border bg-fd-card px-4 font-mono text-sm text-fd-foreground placeholder:text-fd-muted-foreground/50 outline-none transition-colors focus:border-primary"
        />
        <Button
          type="submit"
          variant="cta"
          size="xl"
          disabled={state === "submitting"}
        >
          {state === "submitting" ? "Joining..." : "Join"}
        </Button>
      </form>

      {state === "error" && (
        <p className="mt-4 text-sm text-red-500">{errorMessage}</p>
      )}

      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/60">
        No spam · We&apos;ll only email you when it matters
      </p>
    </section>
  );
}
