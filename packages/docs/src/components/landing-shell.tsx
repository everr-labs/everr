import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Footer } from "@/components/footer";

export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-clip bg-background text-foreground">
      {children}
      <Footer />
    </div>
  );
}
export function LandingLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <a
      className={`inline-flex items-center justify-center gap-3 rounded-full border px-5 py-3.5 text-sm font-semibold transition-opacity duration-150 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-primary motion-reduce:transition-none max-[700px]:px-4 max-[700px]:py-[13px] ${secondary ? "border-foreground/10 bg-transparent text-foreground" : "border-primary bg-primary text-primary-foreground"}`}
      href={href}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}
export function LandingSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mx-auto max-w-[1240px] scroll-mt-[70px] border-b border-foreground/10 px-8 py-[88px] max-[700px]:px-6 max-[700px]:py-14"
    >
      <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
        {eyebrow}
      </p>
      <h2 className="max-w-[790px] text-[clamp(30px,3.5vw,46px)] font-[550] leading-[1.12] tracking-[-0.035em]">
        {title}
      </h2>
      {children}
    </section>
  );
}
