import type { ReactNode } from "react";

interface OnboardingLayoutProps {
  title: string;
  label?: string;
  children: ReactNode;
}

export function OnboardingLayout({
  title,
  label,
  children,
}: OnboardingLayoutProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16">
      <div className="w-full max-w-xl">
        <div className="mb-10 text-center">
          {label && (
            <p className="font-heading text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
          )}
          <h1 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h1>
        </div>

        <section className="border border-border bg-card p-6 sm:p-10">
          {children}
        </section>
      </div>
    </main>
  );
}
