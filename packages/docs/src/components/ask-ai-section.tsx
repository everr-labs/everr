import { AskAiComposer } from "@/components/ask-ai-composer";

export function AskAiSection() {
  return (
    <section className="border-y border-border bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-6 py-12 min-[761px]:grid-cols-2 min-[761px]:gap-16 min-[761px]:py-20">
        <div>
          <h2 className="text-balance text-4xl leading-[1.08] tracking-[-0.03em] min-[761px]:text-[clamp(34px,4vw,52px)]">
            Let your AI kick the tires.
          </h2>
          <p className="mt-6 max-w-[42ch] text-lg leading-[1.6] text-muted-foreground">
            Ask it to read the docs, question the fit, and tell you where Everr
            could help your project.
          </p>
        </div>
        <div className="min-w-0">
          <AskAiComposer />
        </div>
      </div>
    </section>
  );
}
