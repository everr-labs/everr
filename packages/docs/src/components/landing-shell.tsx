import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import "@/styles/landings.css";
export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="everr-landing">
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
      className={`landing-button ${secondary ? "landing-secondary" : ""}`}
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
    <section id={id} className="landing-section">
      <p className="landing-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
