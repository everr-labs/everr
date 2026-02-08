import { useCallback, useEffect, useRef, useState } from "react";

// Chrome Summarizer API type declarations (not in TS standard lib)
interface AISummarizerOptions {
  type?: "key-points" | "tldr" | "teaser" | "headline";
  format?: "markdown" | "plain-text";
  length?: "short" | "medium" | "long";
  sharedContext?: string;
}

interface AISummarizer {
  summarize(text: string, options?: { context?: string }): Promise<string>;
  summarizeStreaming(
    text: string,
    options?: { context?: string },
  ): ReadableStream<string>;
  destroy(): void;
}

interface AISummarizerFactory {
  availability(): Promise<"readily" | "after-download" | "no">;
  create(options?: AISummarizerOptions): Promise<AISummarizer>;
}

declare global {
  interface Window {
    Summarizer?: AISummarizerFactory;
  }
  var Summarizer: AISummarizerFactory | undefined;
}

export type SummarizerStatus =
  | "idle"
  | "creating"
  | "summarizing"
  | "done"
  | "error";

interface UseLogSummarizerResult {
  isAvailable: boolean;
  status: SummarizerStatus;
  summary: string;
  error: string | null;
  summarize: (text: string, context?: string) => Promise<void>;
  reset: () => void;
}

export function useLogSummarizer(): UseLogSummarizerResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [status, setStatus] = useState<SummarizerStatus>("idle");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const summarizerRef = useRef<AISummarizer | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAvailability() {
      if (!("Summarizer" in self) || !self.Summarizer) {
        return;
      }
      try {
        const availability = await self.Summarizer.availability();
        if (!cancelled && availability !== "no") {
          setIsAvailable(true);
        }
      } catch {
        // API not available
      }
    }

    checkAvailability();
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    // Cancel any ongoing streaming
    readerRef.current?.cancel();
    readerRef.current = null;
    summarizerRef.current?.destroy();
    summarizerRef.current = null;

    setSummary("");
    setError(null);
    setStatus("idle");
  }, []);

  const summarize = useCallback(async (text: string, context?: string) => {
    if (!self.Summarizer) {
      return;
    }

    // Clean up previous run
    readerRef.current?.cancel();
    readerRef.current = null;
    summarizerRef.current?.destroy();
    summarizerRef.current = null;

    setSummary("");
    setError(null);
    setStatus("creating");

    try {
      const summarizer = await self.Summarizer.create({
        type: "key-points",
        format: "markdown",
        length: "long",
        sharedContext: "CI/CD build logs from GitHub Actions",
      });
      summarizerRef.current = summarizer;

      setStatus("summarizing");

      const stream = summarizer.summarizeStreaming(text, {
        context: context ? `Logs from step: ${context}` : undefined,
      });
      const reader = stream.getReader();
      readerRef.current = reader;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        setSummary((prev) => prev + value);
      }

      setStatus("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled, don't set error
        return;
      }
      setError(err instanceof Error ? err.message : "Summarization failed");
      setStatus("error");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      readerRef.current?.cancel();
      readerRef.current = null;
      summarizerRef.current?.destroy();
      summarizerRef.current = null;
    };
  }, []);

  return { isAvailable, status, summary, error, summarize, reset };
}
