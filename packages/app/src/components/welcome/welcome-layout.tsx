import { Button } from "@everr/ui/components/button";
import { EverrLogo } from "@everr/ui/components/everr-logo";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { authClient } from "#app/lib/auth-client.ts";
import { AsciiLogo } from "./ascii-logo";

export interface WelcomeLayoutProps {
  signedIn: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function WelcomeLayout({ signedIn, actions, children }: WelcomeLayoutProps) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground lg:grid lg:grid-cols-[1.15fr_1fr]">
      {signedIn && (
        <div className="absolute top-6 right-6 z-30 flex max-w-[calc(100%_-_8rem)] items-center gap-2 lg:top-10 lg:right-10">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/auth/sign-in";
                  },
                },
              })
            }
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </Button>
        </div>
      )}
      {/* On a phone the hero takes what the form leaves of the screen, up to
          280px, and shrinks to a logo strip before the page has to scroll. */}
      <aside className="relative min-h-24 max-h-70 grow-[100] basis-0 overflow-hidden border-b border-white/5 bg-black lg:max-h-none lg:border-r lg:border-b-0">
        <AsciiLogo />
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-6 lg:p-10">
          <a
            href="https://everr.dev"
            className="pointer-events-auto self-start text-foreground"
            aria-label="Everr home"
          >
            <EverrLogo />
          </a>
          <p className="hidden animate-fade-up whitespace-nowrap font-heading text-[clamp(2rem,3.3vw,4rem)] leading-none tracking-tight text-white motion-reduce:animate-none lg:block">
            Observability made simple
          </p>
        </div>
      </aside>
      {children}
    </div>
  );
}
