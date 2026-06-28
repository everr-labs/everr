import { cn } from "@everr/ui/lib/utils";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Star } from "lucide-react";
import { type ComponentProps, use } from "react";

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

export interface GithubInfoProps
  extends ComponentProps<"a">,
    FetchRepositoryInfoOptions {
  locale?: Intl.LocalesArgument;
}

async function fetchRepositoryInfo({
  owner,
  repo,
  token,
  baseUrl = "https://api.github.com",
  fetchOptions = {
    // default revalidate options for Next.js (optional)
    next: {
      revalidate: 60,
    },
  } as RequestInit,
}: FetchRepositoryInfoOptions): Promise<RepositoryInfo> {
  const endpoint = `${baseUrl}/repos/${owner}/${repo}`;
  const headers = new Headers(fetchOptions.headers);

  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(endpoint, {
    ...fetchOptions,
    headers,
  } as RequestInit);

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

const promises: Record<string, Promise<RepositoryInfo>> = {};

export function GithubInfo({
  repo,
  owner,
  token,
  baseUrl,
  fetchOptions,
  locale,
  ...props
}: GithubInfoProps) {
  const options: FetchRepositoryInfoOptions = {
    repo,
    owner,
    token,
    baseUrl,
    fetchOptions,
  };
  const cacheKey = JSON.stringify(options);
  promises[cacheKey] ??= fetchRepositoryInfo(options);
  const { stars } = use(promises[cacheKey]);
  const formatter = locale
    ? new Intl.NumberFormat(locale, formatterOptions)
    : defaultFormatter;

  return (
    <a
      href={`https://github.com/${owner}/${repo}`}
      rel="noreferrer noopener"
      target="_blank"
      {...props}
      className={cn(
        "flex gap-1.5 p-2 rounded-lg text-sm text-fd-foreground/80 transition-colors hover:text-fd-accent-foreground hover:bg-fd-accent",
        props.className,
      )}
    >
      <p className="flex items-center gap-2 truncate">
        <SiGithub className="text-foreground size-5" />
      </p>
      <div className="flex text-xs items-center gap-1 text-fd-muted-foreground">
        <Star className="size-3 fill-primary stroke-primary" />
        <span>{formatter.format(stars)}</span>
      </div>
    </a>
  );
}
