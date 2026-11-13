import {
  SiAngular,
  SiAstro,
  SiBun,
  SiDeno,
  SiDjango,
  SiDjangoHex,
  SiDotnet,
  SiExpress,
  SiExpressHex,
  SiFastapi,
  SiFastapiHex,
  SiGo,
  SiGoHex,
  SiJavascript,
  SiKotlin,
  SiLaravel,
  SiLaravelHex,
  SiNestjs,
  SiNestjsHex,
  SiNextdotjs,
  SiNextdotjsHex,
  SiNodedotjs,
  SiNodedotjsHex,
  SiPhoenixframework,
  SiPhp,
  SiPhpHex,
  SiReact,
  SiRemix,
  SiRuby,
  SiRubyonrails,
  SiRust,
  SiRustHex,
  SiSpring,
  SiSvelte,
  SiSwift,
  SiSymfony,
  SiSymfonyHex,
  SiTanstack,
  SiTanstackHex,
  SiTypescript,
  SiTypescriptHex,
  SiVuedotjs,
} from "@icons-pack/react-simple-icons";
import elixirLogo from "@/assets/logos/elixir.svg?url&no-inline";
import javaLogo from "@/assets/logos/java.svg?url&no-inline";
import pythonLogo from "@/assets/logos/python.svg?url&no-inline";

type Technology =
  | { label: string; image: string }
  | { label: string; icon: typeof SiGo; color: string };

export const STACK: Technology[] = [
  { label: "Elixir", image: elixirLogo },
  { label: "Node.js", icon: SiNodedotjs, color: SiNodedotjsHex },
  { label: "Rust", icon: SiRust, color: SiRustHex },
  { label: "Go", icon: SiGo, color: SiGoHex },
  { label: "Python", image: pythonLogo },
  { label: "TypeScript", icon: SiTypescript, color: SiTypescriptHex },
  { label: "PHP", icon: SiPhp, color: SiPhpHex },
  { label: "Java", image: javaLogo },
  { label: "Symfony", icon: SiSymfony, color: SiSymfonyHex },
  { label: "Laravel", icon: SiLaravel, color: SiLaravelHex },
  { label: "TanStack", icon: SiTanstack, color: SiTanstackHex },
  { label: "Next.js", icon: SiNextdotjs, color: SiNextdotjsHex },
  { label: "Express", icon: SiExpress, color: SiExpressHex },
  { label: "NestJS", icon: SiNestjs, color: SiNestjsHex },
  { label: "Django", icon: SiDjango, color: SiDjangoHex },
  { label: "FastAPI", icon: SiFastapi, color: SiFastapiHex },
];

const extraTechnologies: Technology[] = [
  { label: "React", icon: SiReact, color: "#61DAFB" },
  { label: "Vue", icon: SiVuedotjs, color: "#4FC08D" },
  { label: "Svelte", icon: SiSvelte, color: "#FF3E00" },
  { label: "Angular", icon: SiAngular, color: "#DD0031" },
  { label: "Astro", icon: SiAstro, color: "#FF5D01" },
  { label: "Remix", icon: SiRemix, color: "currentColor" },
  { label: "Ruby", icon: SiRuby, color: "#CC342D" },
  { label: "Rails", icon: SiRubyonrails, color: "#D30001" },
  { label: ".NET", icon: SiDotnet, color: "#9B7EEB" },
  { label: "Kotlin", icon: SiKotlin, color: "#7F52FF" },
  { label: "Swift", icon: SiSwift, color: "#F05138" },
  { label: "Deno", icon: SiDeno, color: "currentColor" },
  { label: "Bun", icon: SiBun, color: "#FBF0DF" },
  { label: "JavaScript", icon: SiJavascript, color: "#F7DF1E" },
  { label: "Spring", icon: SiSpring, color: "#6DB33F" },
  { label: "Phoenix", icon: SiPhoenixframework, color: "#FD4F00" },
];

const technologies = [...STACK, ...extraTechnologies];

// The backdrop repeats a few icons across 128 cells. Each icon is drawn once,
// as a symbol in this sprite, and every cell points at it: inline, the icons
// made up most of the home page's HTML.
export const TECHNOLOGY_SPRITE_PATH = "/technology-icons.svg";

const symbolId = (label: string) => `technology-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function TechnologySprite() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        {technologies.map((item) =>
          "icon" in item ? (
            <symbol key={item.label} id={symbolId(item.label)} viewBox="0 0 24 24">
              <item.icon
                title=""
                color={item.color.toLowerCase() === "#000000" ? "currentColor" : item.color}
              />
            </symbol>
          ) : null,
        )}
      </defs>
    </svg>
  );
}

export function TechnologyBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-35 [mask-image:radial-gradient(ellipse_at_32%_50%,rgba(0,0,0,0.22)_12%,#000_75%)] max-[760px]:[mask-image:linear-gradient(180deg,rgba(0,0,0,0.2),#000_65%)]"
      aria-hidden="true"
    >
      <div className="absolute -inset-x-[100px] -inset-y-[140px] grid grid-cols-16 grid-rows-8 place-items-center rotate-[-14deg] scale-[1.12] *:grid *:size-full *:place-items-center *:*:size-11 *:*:rotate-[14deg] *:[&>img]:object-contain max-[760px]:-inset-y-20 max-[760px]:inset-x-auto max-[760px]:left-1/2 max-[760px]:w-[960px] max-[760px]:-translate-x-1/2 max-[760px]:scale-100 max-[760px]:grid-cols-12 max-[760px]:grid-rows-11 max-[760px]:*:*:size-8">
        {Array.from({ length: 128 }, (_, index) => {
          const item = technologies[(index * 7 + Math.floor(index / 16) * 3) % technologies.length];
          return (
            <span key={index}>
              {"image" in item ? (
                <img src={item.image} alt="" />
              ) : (
                <svg>
                  <use href={`${TECHNOLOGY_SPRITE_PATH}#${symbolId(item.label)}`} />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
