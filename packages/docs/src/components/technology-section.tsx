import {
  SiDjango,
  SiDjangoHex,
  SiExpress,
  SiExpressHex,
  SiFastapi,
  SiFastapiHex,
  SiGo,
  SiGoHex,
  SiLaravel,
  SiLaravelHex,
  SiNestjs,
  SiNestjsHex,
  SiNextdotjs,
  SiNextdotjsHex,
  SiNodedotjs,
  SiNodedotjsHex,
  SiPhp,
  SiPhpHex,
  SiRust,
  SiRustHex,
  SiSymfony,
  SiSymfonyHex,
  SiTanstack,
  SiTanstackHex,
  SiTypescript,
  SiTypescriptHex,
} from "@icons-pack/react-simple-icons";
import elixirLogo from "@/assets/logos/elixir.svg?url";
import javaLogo from "@/assets/logos/java.svg?url";
import pythonLogo from "@/assets/logos/python.svg?url";
import { TechnologyBackdrop } from "@/components/technology-backdrop";

type Technology =
  | { label: string; image: string }
  | { label: string; icon: typeof SiGo; color: string };

const languages: Technology[] = [
  { label: "Elixir", image: elixirLogo },
  { label: "Node.js", icon: SiNodedotjs, color: SiNodedotjsHex },
  { label: "Rust", icon: SiRust, color: SiRustHex },
  { label: "Go", icon: SiGo, color: SiGoHex },
  { label: "Python", image: pythonLogo },
  { label: "TypeScript", icon: SiTypescript, color: SiTypescriptHex },
  { label: "PHP", icon: SiPhp, color: SiPhpHex },
  { label: "Java", image: javaLogo },
];

const frameworks: Technology[] = [
  { label: "Symfony", icon: SiSymfony, color: SiSymfonyHex },
  { label: "Laravel", icon: SiLaravel, color: SiLaravelHex },
  { label: "TanStack", icon: SiTanstack, color: SiTanstackHex },
  { label: "Next.js", icon: SiNextdotjs, color: SiNextdotjsHex },
  { label: "Express", icon: SiExpress, color: SiExpressHex },
  { label: "NestJS", icon: SiNestjs, color: SiNestjsHex },
  { label: "Django", icon: SiDjango, color: SiDjangoHex },
  { label: "FastAPI", icon: SiFastapi, color: SiFastapiHex },
];

export function TechnologySection() {
  return (
    <section className="relative isolate overflow-hidden bg-fd-card/40">
      <div className="isolate mx-auto grid min-h-[480px] max-w-7xl place-items-start px-6 py-16 sm:min-h-[460px] sm:place-items-center sm:justify-items-start sm:px-12 sm:py-20">
        <TechnologyBackdrop items={[...languages, ...frameworks]} />
        <h2 className="pointer-events-none relative z-10 max-w-[17ch] text-balance text-4xl leading-[1.1] tracking-[-0.03em] sm:max-w-[16ch] sm:text-[clamp(34px,4.3vw,56px)]">
          Everr works with the stack you already run.
        </h2>
        <span className="sr-only">
          Languages and runtimes:{" "}
          {languages.map((item) => item.label).join(", ")}. Frameworks:{" "}
          {frameworks.map((item) => item.label).join(", ")}.
        </span>
      </div>
    </section>
  );
}
