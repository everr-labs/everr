import { cn } from "@everr/ui/lib/utils";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Star } from "lucide-react";
import { ClientOnly } from "@tanstack/react-router";
import { type ComponentProps, Suspense, use } from "react";

export interface FetchRepositoryInfoOptions {
  owner: string;
  repo: string;

  baseUrl?: string;
  token?: string;
  fetchOptions?: RequestInit;
}

interface RepositoryInfo {
  stars: number;
}

export interface GithubInfoProps extends ComponentProps<"a">, FetchRepositoryInfoOptions {
  locale?: Intl.LocalesArgument;
}

// default revalidate options for Next.js (optional). `next` is a Next.js
// augmentation of RequestInit, so widen the type to keep it well-typed.
function defaultFetchOptions(): RequestInit & { next?: { revalidate?: number } } {
  return { next: { revalidate: 60 } };
}

async function fetchRepositoryInfo({
  owner,
  repo,
  token,
  baseUrl = "https://api.github.com",
  fetchOptions = defaultFetchOptions(),
}: FetchRepositoryInfoOptions): Promise<RepositoryInfo> {
  const endpoint = `${baseUrl}/repos/${owner}/${repo}`;
  const headers = new Headers(fetchOptions.headers);

  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(endpoint, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();

    throw new Error(`Failed to fetch repository data: ${message}`);
  }

  const data = await response.json();
  return {
    stars: data.stargazers_count,
  };
}

/**
 * Uses compact notation (e.g., 1.5K, 2.3M).
 */
const formatterOptions: Intl.NumberFormatOptions = {
  notation: "compact",
  maximumFractionDigits: 1,
};

const defaultFormatter = new Intl.NumberFormat(undefined, formatterOptions);

// GitHub allows 60 anonymous requests an hour from one address. One answer is asked for
// at most every ten minutes, and a refusal is kept just as long: asking again on the
// next render would send a request per render for as long as the limit lasts.
const KEEP_MS = 10 * 60 * 1000;
const STORED = "everr:github-stars:";

const asked: Record<string, { at: number; info: Promise<RepositoryInfo | null> }> = {};

/** What an earlier page load in this browser learned, while it is still fresh */
function remembered(cacheKey: string): RepositoryInfo | null | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(STORED + cacheKey) ?? "null");
    if (stored && Date.now() - stored.at < KEEP_MS) return stored.info;
  } catch {
    // Storage is blocked: ask GitHub
  }
  return undefined;
}

function remember(cacheKey: string, info: RepositoryInfo | null) {
  try {
    localStorage.setItem(STORED + cacheKey, JSON.stringify({ at: Date.now(), info }));
  } catch {
    // Kept for this page only
  }
}

function repositoryInfo(options: FetchRepositoryInfoOptions) {
  const cacheKey = JSON.stringify(options);
  const kept = asked[cacheKey];
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.info;

  const known = remembered(cacheKey);
  const info =
    known === undefined
      ? fetchRepositoryInfo(options)
          .catch(() => null)
          .then((found) => {
            remember(cacheKey, found);
            return found;
          })
      : Promise.resolve(known);
  asked[cacheKey] = { at: Date.now(), info };
  return info;
}

function Stars({
  locale,
  ...options
}: FetchRepositoryInfoOptions & Pick<GithubInfoProps, "locale">) {
  const info = use(repositoryInfo(options));
  if (!info) return null;
  const formatter = locale ? new Intl.NumberFormat(locale, formatterOptions) : defaultFormatter;

  return (
    <div className="flex text-xs items-center gap-1 text-fd-muted-foreground">
      <Star className="size-3 fill-primary stroke-primary" />
      <span>{formatter.format(info.stars)}</span>
    </div>
  );
}

export function GithubInfo({
  repo,
  owner,
  token,
  baseUrl,
  fetchOptions,
  locale,
  ...props
}: GithubInfoProps) {
  return (
    <a
      href={`https://github.com/${owner}/${repo}`}
      rel="noreferrer noopener"
      target="_blank"
      {...props}
      className={cn(
        "flex gap-1.5 p-2 rounded-full text-sm text-fd-foreground/80 transition-colors hover:text-fd-accent-foreground hover:bg-fd-accent",
        props.className,
      )}
    >
      <p className="flex items-center gap-2 truncate">
        <SiGithub className="text-foreground size-5" />
        {props.children}
      </p>
      {/* The count is the visitor's browser's to ask for: the server's address would spend one
          allowance for everybody, and its answer need not match what the browser is told.
          Without a count, the link still stands. */}
      <ClientOnly>
        <Suspense>
          <Stars
            repo={repo}
            owner={owner}
            token={token}
            baseUrl={baseUrl}
            fetchOptions={fetchOptions}
            locale={locale}
          />
        </Suspense>
      </ClientOnly>
    </a>
  );
}
