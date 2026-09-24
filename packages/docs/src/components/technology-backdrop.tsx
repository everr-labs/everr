import {
  SiAngular,
  SiAstro,
  SiBun,
  SiDeno,
  SiDotnet,
  SiJavascript,
  SiKotlin,
  SiPhoenixframework,
  SiReact,
  SiRemix,
  SiRuby,
  SiRubyonrails,
  SiSpring,
  SiSvelte,
  SiSwift,
  SiVuedotjs,
} from "@icons-pack/react-simple-icons";

type Technology =
  | { label: string; image: string }
  | { label: string; icon: typeof SiReact; color: string };

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

export function TechnologyBackdrop({ items }: { items: Technology[] }) {
  const technologies = [...items, ...extraTechnologies];

  return (
    <div className="technology-static" aria-hidden="true">
      <div className="technology-static-grid">
        {Array.from({ length: 128 }, (_, index) => {
          const item =
            technologies[
              (index * 7 + Math.floor(index / 16) * 3) % technologies.length
            ];
          return (
            <span className="technology-static-mark" key={index}>
              {"image" in item ? (
                <img src={item.image} alt="" />
              ) : (
                <item.icon
                  color={
                    item.color.toLowerCase() === "#000000"
                      ? "currentColor"
                      : item.color
                  }
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
