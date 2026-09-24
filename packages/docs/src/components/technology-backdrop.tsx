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
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const technologies = [...items, ...extraTechnologies];

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="technology-motion"
      ref={root}
      data-running={visible && !paused}
    >
      <div className="technology-field" aria-hidden="true">
        <div className="technology-plane">
          {[0, 1, 2, 3].map((row) => (
            <div className="technology-track" key={row}>
              {[0, 1].map((copy) => (
                <div className="technology-sequence" key={copy}>
                  {technologies
                    .filter((_, index) => index % 4 === row)
                    .map((item) => (
                      <span className="technology-mark" key={item.label}>
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
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="technology-pause"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? "Play logo animation" : "Pause logo animation"}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </button>
    </div>
  );
}
