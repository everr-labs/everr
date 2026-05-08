import { SiCursor, SiZedindustries } from "@icons-pack/react-simple-icons";
import Antigravity from "./icons/antigravity.svg?react";
import ClaudeCode from "./icons/claudecode.svg?react";
import Codex from "./icons/codex.svg?react";
import Copilot from "./icons/githubcopilot.svg?react";
import Intellij from "./icons/intellij.svg?react";
import OpenCode from "./icons/opencode.svg?react";
import Pi from "./icons/pi.svg?react";
import VsCode from "./icons/vscode.svg?react";
import { OrbitingCircles } from "./orbiting-circles";

export function ToolsExplainer() {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 py-20 md:grid-cols-2 md:gap-16 md:py-24">
      <div className="pointer-events-none relative col-start-1 row-start-1 mx-auto aspect-square w-full max-w-sm overflow-hidden opacity-20 md:pointer-events-auto md:col-start-1 md:row-start-1 md:max-w-md md:opacity-100">
        <OrbitingCircles radius={140}>
          <ClaudeCode className="size-8" />
          <OpenCode className="size-8" />
          <Codex className="size-8" />
          <Pi className="size-8" />
          <Copilot className="size-8" />
        </OrbitingCircles>
        <OrbitingCircles radius={70} reverse>
          <VsCode className="size-8" />
          <SiZedindustries className="size-8" />
          <Intellij className="size-8" />
          <SiCursor className="size-8" />
          <Antigravity className="size-8" />
        </OrbitingCircles>
      </div>

      <div className="relative z-10 col-start-1 row-start-1 text-left md:col-start-2 md:text-right">
        <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          Editor-agnostic · Agent-agnostic
        </p>
        <h2 className="mt-4 font-heading text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
          Your tools.
          <br className="hidden sm:block" /> Your rules.
        </h2>
        <div className="prose mt-8 space-y-5 text-base leading-relaxed text-fd-muted-foreground sm:text-lg md:ml-auto md:max-w-md">
          <p>
            Observability shouldn't be <strong>prescriptive</strong>. We don't
            care which editor you opened this morning, which model is in your
            terminal, or which agent shipped that PR while you were asleep.
          </p>
          <p>
            Everr meets your work where it{" "}
            <span className="text-fd-foreground">already happens</span> — VS
            Code, Cursor, Zed, JetBrains, Claude Code, Codex, Copilot, every CLI
            in between.
          </p>
          <p className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-fd-foreground">
            Everr doesn't replace your stack, it improves it.
          </p>
        </div>
      </div>
    </div>
  );
}
